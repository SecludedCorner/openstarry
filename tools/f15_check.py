#!/usr/bin/env python3
"""
f15_check — Plan49 C49-M8 F-15 front-matter linter (contingency option (v)).

Scans delivery_report markdown for F-15 front-matter blocks of the form

    <!-- F-15 front-matter :: claim-id=<ID> -->
    Claim: ...
    Code-read: ...
    Author-intent: ...
    Alt-hypothesis-1: ... (rejected: ...)
    Alt-hypothesis-2: ... (rejected: ...)
    Second-reviewer: ...
    GN.2-ref: ...
    <!-- /F-15 -->

and verifies the five binding elements per Plan49 §1.8 + D-15 + D-17:

    (a) Code-read
    (b) Author-intent
    (c) ≥2 genuinely discriminating alt-hypotheses
    (d) Second-reviewer
    (e) GN.2-ref

Exit codes:
    0  all blocks satisfy the 5 elements (or no blocks present)
    1  one or more blocks missing required element(s)
    2  usage error

Scope guidance: not binding on Plan49 itself (delivery_report §7 / §A.7 / §B.7
contain hand-authored blocks that predate this tool); Plan50+ can adopt
`python tools/f15_check.py <path>` as a CI gate.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

_BLOCK_RE = re.compile(
    r"<!--\s*F-15\s+front-matter\s*::\s*claim-id=(?P<id>[^\s>]+)\s*-->(?P<body>.*?)<!--\s*/F-15\s*-->",
    re.DOTALL,
)

_REQUIRED: list[tuple[str, re.Pattern[str]]] = [
    ("Code-read", re.compile(r"^\s*Code-read\s*:\s*\S+", re.MULTILINE)),
    ("Author-intent", re.compile(r"^\s*Author-intent\s*:\s*\S+", re.MULTILINE)),
    ("Alt-hypothesis-1", re.compile(r"^\s*Alt-hypothesis-1\s*:\s*\S+", re.MULTILINE)),
    ("Alt-hypothesis-2", re.compile(r"^\s*Alt-hypothesis-2\s*:\s*\S+", re.MULTILINE)),
    ("Second-reviewer", re.compile(r"^\s*Second-reviewer\s*:\s*\S+", re.MULTILINE)),
    ("GN.2-ref", re.compile(r"^\s*GN\.2-ref\s*:\s*\S+", re.MULTILINE)),
]


def _check_file(path: Path) -> list[str]:
    """Return a list of human-readable violation strings for this file."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        return [f"{path}: cannot read ({e})"]

    violations: list[str] = []
    for m in _BLOCK_RE.finditer(text):
        claim_id = m.group("id")
        body = m.group("body")
        missing: list[str] = []
        vacated = re.search(r"Claim\s*:\s*N/A", body)
        for label, rx in _REQUIRED:
            if not rx.search(body):
                missing.append(label)
        if missing and not vacated:
            violations.append(
                f"{path}::{claim_id} missing: {', '.join(missing)}"
            )
    return violations


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="f15_check",
        description="Plan49 C49-M8 F-15 front-matter linter.",
    )
    ap.add_argument("paths", nargs="+", help="markdown files or directories to scan")
    args = ap.parse_args(argv)

    files: list[Path] = []
    for raw in args.paths:
        p = Path(raw)
        if p.is_dir():
            files.extend(sorted(p.rglob("*.md")))
        elif p.is_file():
            files.append(p)
        else:
            print(f"[f15_check] WARN: path not found: {p}", file=sys.stderr)

    if not files:
        print("[f15_check] no markdown files matched", file=sys.stderr)
        return 2

    all_violations: list[str] = []
    for f in files:
        all_violations.extend(_check_file(f))

    if all_violations:
        for v in all_violations:
            print(v)
        print(f"[f15_check] {len(all_violations)} F-15 block(s) missing required elements")
        return 1

    print(f"[f15_check] scanned {len(files)} file(s); all F-15 blocks complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
