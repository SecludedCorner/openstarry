"""
Pytest conformance tests for audit_calc (Plan49 §八 MVP).

Covers the pure layer (parse / evaluate / tolerance / hash / tautology) plus
the NFR-6a "no string-eval" invariant via source-grep enforcement.
"""

from __future__ import annotations

import math
import os
import sys
from pathlib import Path

import pytest

# audit_calc_core imports from the parent dir; pytest run from tools/.
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from audit_calc_core import (  # noqa: E402
    detect_tautology_marker,
    evaluate_ast,
    invariant_hash,
    parse_claim_block,
    tolerance_check,
)

# ─── parse_claim_block ───


def test_parse_simple_number() -> None:
    ast = parse_claim_block("0.04751")
    r = evaluate_ast(ast, {})
    assert r.value is not None
    assert math.isclose(r.value, 0.04751, rel_tol=1e-12)


def test_parse_scientific_notation() -> None:
    ast = parse_claim_block("1.5e-10")
    r = evaluate_ast(ast, {})
    assert r.value is not None
    assert math.isclose(r.value, 1.5e-10, rel_tol=1e-12)


def test_right_associative_power() -> None:
    # 2^3^2 = 2^9 = 512 (right-assoc), NOT 8^2 = 64.
    ast = parse_claim_block("2^3^2")
    r = evaluate_ast(ast, {})
    assert r.value is not None
    assert math.isclose(r.value, 512.0, rel_tol=1e-12)


def test_precedence_stratification() -> None:
    # a + b*c^d with a=1, b=2, c=3, d=2 → 1 + 2*9 = 19
    ast = parse_claim_block("1 + 2*3^2")
    r = evaluate_ast(ast, {})
    assert r.value is not None
    assert math.isclose(r.value, 19.0, rel_tol=1e-12)


def test_negative_exponent() -> None:
    # 10^-4 → 1e-4 (regression: required `!unary_expr` in grammar to preserve -)
    ast = parse_claim_block("10^-4")
    r = evaluate_ast(ast, {})
    assert r.value is not None
    assert math.isclose(r.value, 1e-4, rel_tol=1e-12)


def test_whitelisted_function_sqrt() -> None:
    ast = parse_claim_block("sqrt(16)")
    r = evaluate_ast(ast, {})
    assert r.value is not None
    assert math.isclose(r.value, 4.0, rel_tol=1e-12)


def test_non_whitelisted_function_rejected() -> None:
    # `foo` is not in _WHITELIST; parsing succeeds but evaluate fails.
    ast = parse_claim_block("foo(1, 2)")
    r = evaluate_ast(ast, {})
    assert r.value is None
    assert any("whitelist" in w for w in r.warnings)


# ─── tolerance_check ───


def test_tolerance_sensitivity_within_oom() -> None:
    # 0.1 OOM ≈ ×1.26 factor
    v = tolerance_check(expected=1e-48, actual=8e-49, tol_class="sensitivity")
    assert v.passed


def test_tolerance_sensitivity_beyond_oom() -> None:
    # >0.1 OOM deviation should fail
    v = tolerance_check(expected=1e-48, actual=1e-50, tol_class="sensitivity")
    assert not v.passed


def test_tolerance_probability_wide_band() -> None:
    # 0.5 OOM ≈ ×3.16 factor → factor-of-3 drift is inside band
    v = tolerance_check(expected=1e-4, actual=3e-4, tol_class="probability")
    assert v.passed


def test_tolerance_proportion_absolute_band() -> None:
    v = tolerance_check(expected=0.20, actual=0.23, tol_class="proportion")
    assert v.passed
    v = tolerance_check(expected=0.20, actual=0.30, tol_class="proportion")
    assert not v.passed


def test_tolerance_zero_expected_falls_back_to_absolute() -> None:
    v = tolerance_check(expected=0.0, actual=1e-5, tol_class="sensitivity")
    # sensitivity=0.1 OOM → absolute eps = 10^-0.1 ≈ 0.794; 1e-5 ≤ 0.794 → pass
    assert v.passed


def test_tolerance_non_finite_rejected() -> None:
    v = tolerance_check(expected=float("nan"), actual=1.0, tol_class="sensitivity")
    assert not v.passed
    v = tolerance_check(expected=1.0, actual=float("inf"), tol_class="probability")
    assert not v.passed


# ─── invariant_hash ───


def test_hash_triple_deterministic(tmp_path: Path) -> None:
    f = tmp_path / "sample.md"
    f.write_text("sample corpus", encoding="utf-8")
    script = tmp_path / "dummy.py"
    script.write_text("x = 1\n", encoding="utf-8")
    env = {"numpy": "2.0.0", "sympy": "1.14.0", "lark": "1.3.1"}

    h1 = invariant_hash([f], script, env)
    h2 = invariant_hash([f], script, env)
    assert h1 == h2
    assert len(h1.corpus_sha256) == 64
    assert len(h1.script_sha256) == 64
    assert len(h1.python_env_hash) == 64


def test_hash_changes_when_corpus_changes(tmp_path: Path) -> None:
    f = tmp_path / "sample.md"
    f.write_text("a", encoding="utf-8")
    script = tmp_path / "dummy.py"
    script.write_text("x = 1\n", encoding="utf-8")
    env = {"numpy": "2.0.0"}

    h1 = invariant_hash([f], script, env)
    f.write_text("b", encoding="utf-8")
    h2 = invariant_hash([f], script, env)
    assert h1.corpus_sha256 != h2.corpus_sha256


# ─── @tautology marker ───


def test_tautology_marker_on_claim_line() -> None:
    line = "V11 = 1.0000x  <!-- @tautology: V11 = new_ref / new_ref = 1 by construction -->"
    assert detect_tautology_marker([], line) is not None


def test_tautology_marker_within_3_preceding_lines() -> None:
    prior = [
        "some normal line",
        "<!-- @tautology: computation is identity on fixed fixture -->",
        "another line",
    ]
    claim = "V11 = 1.0000x"
    assert detect_tautology_marker(prior, claim) is not None


def test_no_tautology_marker_when_absent() -> None:
    assert detect_tautology_marker(["line"], "P = 1e-48") is None


# ─── NFR-6a source-grep enforcement ───


def test_nfr6a_no_string_eval_in_source() -> None:
    """CI-lint: the audit_calc source must NEVER invoke sympy.sympify /
    parse_expr / S / eval / exec / compile / numexpr.evaluate on user strings.
    Allowed: mention the names in commentary explicitly marked as the forbidden
    list (look for the word 'FORBIDDEN' / 'NFR-6a' on the context line).
    """
    src_files = [
        HERE.parent / "audit_calc.py",
        HERE.parent / "audit_calc_core.py",
    ]
    forbidden_call_patterns = [
        "sympy.sympify(",
        "sympy.parse_expr(",
        "sympy.S(",
        "numexpr.evaluate(",
        "asteval.Interpreter(",
    ]
    violations: list[str] = []
    for src in src_files:
        lines = src.read_text(encoding="utf-8").splitlines()
        for i, raw_line in enumerate(lines, start=1):
            stripped = raw_line.strip()
            if not stripped:
                continue
            # Skip comment lines that document the forbidden list.
            if stripped.startswith("#") or stripped.startswith("//"):
                continue
            for pat in forbidden_call_patterns:
                if pat in raw_line:
                    violations.append(f"{src.name}:{i}: {raw_line.strip()}")
    assert not violations, "\n".join(violations)
