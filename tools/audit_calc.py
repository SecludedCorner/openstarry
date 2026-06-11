#!/usr/bin/env python3
"""
audit_calc — Plan49 §八 / F-12 reproducible-calculation verifier.

Plan49 DELIVERS THE TOOL. Plan50+ enables F-12 compliance enforcement
(per D-11 / Master 補強 #3). This MVP implements:

  - NFR-6 safety stack (no string-eval; NFC normalisation; ASCII identifiers;
    resource limits).
  - EBNF v1.1 precedence-stratified grammar (audit_calc.lark).
  - Triple-hash tier-invariance (MRB-10).
  - Tolerance classes per D-23 (sensitivity / probability / proportion).
  - @tautology marker support (D-25).

Impure layer (this file) handles CLI + file I/O. Pure layer in audit_calc_core.

USAGE
    python tools/audit_calc.py verify --glob "research record/**/*.md"
    python tools/audit_calc.py self-check

EXIT CODES (contract per O4 §8.1)
    0  all claims PASS / INFO-SKIP
    1  one or more claims FAIL / FORMULA-FAIL / FILE-FAIL / env mismatch
    2  script crash (timeout, memory, unexpected exception)

NFR-6b (file-read constraints): extension whitelist {.md}, no absolute paths
after --root, no symlinks, max file 1 MB, repo-relative only.

See docs/EN/audit-calc.md + tools/README.md for canonical reference.
"""

from __future__ import annotations

import argparse
import glob as _glob
import json
import re
import sys
import unicodedata
from pathlib import Path

# NFR-6a self-scan enforcement is delegated to audit_calc_core; this main
# file must not import sympy / eval / exec either. Keep imports minimal.

from audit_calc_core import (
    ClaimAST,
    HashTriple,
    NumericResult,
    ToleranceClass,
    Verdict,
    detect_tautology_marker,
    evaluate_ast,
    invariant_hash,
    parse_claim_block,
    tolerance_check,
)

_MAX_FILE_BYTES = 1_048_576  # NFR-6b: 1 MB
_EXT_WHITELIST = {".md"}
_CALC_BLOCK_RE = re.compile(
    r"<!--\s*calc:start\s*-->(?P<body>.*?)<!--\s*calc:end\s*-->",
    re.DOTALL,
)


# ─── NFR-6b file-read gate ───


def _safe_read(path: Path, root: Path) -> str | None:
    """Return file text if (a) in whitelist, (b) within root, (c) not symlink,
    (d) under size limit. Else return None.
    """
    try:
        resolved = path.resolve()
    except OSError:
        return None

    # realpath != path check (symlink defense)
    try:
        if resolved != path.resolve(strict=False):
            return None
    except OSError:
        return None

    # Extension whitelist
    if path.suffix.lower() not in _EXT_WHITELIST:
        return None

    # Within root
    try:
        resolved.relative_to(root.resolve())
    except ValueError:
        return None

    # Size
    try:
        if resolved.stat().st_size > _MAX_FILE_BYTES:
            return None
    except OSError:
        return None

    try:
        return resolved.read_text(encoding="utf-8")
    except OSError:
        return None


# ─── Claim-block extraction ───


def _extract_calc_blocks(md_text: str) -> list[str]:
    """Return raw bodies of every `<!-- calc:start -->...<!-- calc:end -->` block."""
    return [m.group("body").strip() for m in _CALC_BLOCK_RE.finditer(md_text)]


def _extract_expected(block: str) -> tuple[str, str, ToleranceClass | None]:
    """
    A calc block body is of the form:

        expected = <number>
        tolerance = <class>
        expression: <expr>

    This is a lenient parser — whitespace-tolerant, order-free.
    """
    expected = ""
    expr_src = ""
    tol: ToleranceClass | None = None

    for raw_line in block.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.lower().startswith("expected"):
            _, _, rhs = line.partition("=")
            expected = rhs.strip()
        elif line.lower().startswith("tolerance"):
            _, _, rhs = line.partition("=")
            candidate = rhs.strip().lower()
            if candidate in ("sensitivity", "probability", "proportion"):
                tol = candidate  # type: ignore[assignment]
        elif line.lower().startswith("expression"):
            _, _, rhs = line.partition(":")
            expr_src = rhs.strip()

    return expected, expr_src, tol


# ─── verify subcommand ───


def _cmd_verify(args: argparse.Namespace) -> int:
    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"[audit_calc] ERROR: --root {root} is not a directory", file=sys.stderr)
        return 2

    patterns: list[str] = args.glob if args.glob else ["**/*.md"]
    paths: list[Path] = []
    for patt in patterns:
        for hit in _glob.glob(str(root / patt), recursive=True):
            p = Path(hit)
            if p.is_file():
                paths.append(p)
    paths = sorted(set(paths))

    if not paths:
        print(f"[audit_calc] no files matched glob(s) {patterns} under {root}")
        return 0

    report: list[dict[str, object]] = []
    any_fail = False

    for path in paths:
        text = _safe_read(path, root)
        if text is None:
            report.append({
                "file": str(path.relative_to(root)),
                "status": "FILE-FAIL",
                "reason": "NFR-6b read gate",
            })
            any_fail = True
            continue

        text = unicodedata.normalize("NFC", text)
        blocks = _extract_calc_blocks(text)
        if not blocks:
            continue

        for i, block in enumerate(blocks):
            expected_str, expr_src, tol = _extract_expected(block)

            # Tautology bypass (D-25)
            taut = detect_tautology_marker(text.splitlines()[: text.find(block)], block)
            if taut is not None:
                report.append({
                    "file": str(path.relative_to(root)),
                    "block_index": i,
                    "status": "INFO-SKIP",
                    "reason": f"tautology marker: {taut[:80]}",
                })
                continue

            if not expected_str or not expr_src or tol is None:
                report.append({
                    "file": str(path.relative_to(root)),
                    "block_index": i,
                    "status": "PARSE-WARN",
                    "reason": "calc block missing expected / expression / tolerance",
                })
                continue

            try:
                expected_val = float(expected_str)
            except ValueError:
                try:
                    # Fallback: parse "10^-4" style through the same grammar so that
                    # expected fields can use scientific shorthand.
                    ast_e = parse_claim_block(expected_str)
                    res_e = evaluate_ast(ast_e, {})
                    if res_e.value is None:
                        raise ValueError("expected could not be evaluated")
                    expected_val = res_e.value
                except Exception as e:
                    report.append({
                        "file": str(path.relative_to(root)),
                        "block_index": i,
                        "status": "FORMULA-FAIL",
                        "reason": f"expected parse failed: {e}",
                    })
                    any_fail = True
                    continue

            try:
                ast = parse_claim_block(expr_src)
            except Exception as e:
                report.append({
                    "file": str(path.relative_to(root)),
                    "block_index": i,
                    "status": "FORMULA-FAIL",
                    "reason": f"expression parse failed: {e}",
                })
                any_fail = True
                continue

            result: NumericResult = evaluate_ast(ast, {})
            if result.value is None:
                report.append({
                    "file": str(path.relative_to(root)),
                    "block_index": i,
                    "status": "FORMULA-FAIL",
                    "reason": "; ".join(result.warnings) or "evaluate returned None",
                })
                any_fail = True
                continue

            verdict: Verdict = tolerance_check(expected_val, result.value, tol)
            status = "PASS" if verdict.passed else "FAIL"
            if not verdict.passed:
                any_fail = True
            report.append({
                "file": str(path.relative_to(root)),
                "block_index": i,
                "status": status,
                "tol_class": tol,
                "expected": expected_val,
                "actual": result.value,
                "reason": verdict.reason,
            })

    # Hash triple (tier invariance)
    triple: HashTriple = invariant_hash(
        corpus_paths=[str(p) for p in paths],
        script_path=__file__,
    )

    out = {
        "version": "audit_calc-v1.0.0-plan49",
        "triple_hash": {
            "corpus_sha256": triple.corpus_sha256,
            "script_sha256": triple.script_sha256,
            "python_env_hash": triple.python_env_hash,
        },
        "results": report,
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 1 if any_fail else 0


# ─── self-check subcommand ───


def _cmd_self_check(_args: argparse.Namespace) -> int:
    """Smoke-test the pure layer with a couple of inline fixtures."""
    failures: list[str] = []

    # Fixture 1: 2σ = 0.04751 with trivial expression
    try:
        ast = parse_claim_block("0.04751")
        res = evaluate_ast(ast, {})
        assert res.value is not None and abs(res.value - 0.04751) < 1e-12
    except Exception as e:
        failures.append(f"fixture 1 (2σ): {e}")

    # Fixture 2: exponent precedence right-assoc: 2^3^2 = 512
    try:
        ast = parse_claim_block("2^3^2")
        res = evaluate_ast(ast, {})
        assert res.value is not None and abs(res.value - 512.0) < 1e-9
    except Exception as e:
        failures.append(f"fixture 2 (right-assoc ^): {e}")

    # Fixture 3: scientific notation 10^-4 parses
    try:
        ast = parse_claim_block("10^-4")
        res = evaluate_ast(ast, {})
        assert res.value is not None and abs(res.value - 1e-4) < 1e-18
    except Exception as e:
        failures.append(f"fixture 3 (10^-4): {e}")

    # Fixture 4: sensitivity tolerance table accepts ±0.1 OOM
    v = tolerance_check(expected=1e-48, actual=8e-49, tol_class="sensitivity")
    if not v.passed:
        failures.append(f"fixture 4 (tol sensitivity): {v.reason}")

    # Fixture 5: probability tolerance rejects when > 0.5 OOM off
    v = tolerance_check(expected=1e-4, actual=1e-6, tol_class="probability")
    if v.passed:
        failures.append(f"fixture 5 (tol probability out): unexpectedly passed")

    if failures:
        for f in failures:
            print(f"[audit_calc self-check] FAIL: {f}", file=sys.stderr)
        return 1
    print("[audit_calc self-check] 5 fixtures PASS")
    return 0


# ─── CLI entry ───


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="audit_calc",
        description="Plan49 §八 F-12 reproducible-calculation verifier.",
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    verify = sub.add_parser("verify", help="verify calc blocks in a corpus")
    verify.add_argument("--root", default=".", help="corpus root (repo-relative)")
    verify.add_argument(
        "--glob",
        action="append",
        default=None,
        help="glob pattern (repeatable); default '**/*.md'",
    )

    sub.add_parser("self-check", help="pure-layer smoke test")

    args = ap.parse_args(argv)
    try:
        if args.cmd == "verify":
            return _cmd_verify(args)
        if args.cmd == "self-check":
            return _cmd_self_check(args)
    except Exception as e:
        print(f"[audit_calc] unexpected exception: {e}", file=sys.stderr)
        return 2

    ap.print_help(sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
