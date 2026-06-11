#!/usr/bin/env python3
"""dev_backlog_lint.py — Validate cycle deliver/dev_backlog.md format.

Requirements per Master directive 2026-05-23-c "5-criterion test":
    1. Engineering owner clearly designated
    2. Implementation merged Dev code (file:line + change spec)
    3. Validation result (test pass / acceptance criteria)
    4. Measurable runtime impact (or N/A explicitly documented)
    5. Item linked to research output (cycle / ratified D-item)

Lint rules:
    - File must exist and be non-empty
    - Must either:
        (a) Contain ≥1 ticket-shaped section with all 5 required fields
        (b) Contain explicit "0 actionable items + <rationale>" declaration
    - Each ticket section must include:
        file:    <path>:<line>          (or "N/A: <reason>")
        spec:    <change description>
        owner:   <name>
        accept:  <acceptance criteria>
        target:  <cycle / SLA date>

Usage:
    dev_backlog_lint.py <dev_backlog.md>
    dev_backlog_lint.py --json <file>

Exit codes:
    0 = pass
    1 = lint failure
    2 = error (file missing)
"""
import argparse
import json
import re
import sys
from pathlib import Path

REQUIRED_FIELDS = ("file", "spec", "owner", "accept", "target")
ZERO_ACTIONABLE_RE = re.compile(
    r"^0\s+actionable\s+items?\s*\+?\s*(?:rationale|reason)[:\s]",
    re.IGNORECASE | re.MULTILINE,
)
TICKET_HEADER_RE = re.compile(r"^###\s+(\S.*?)\s*$", re.MULTILINE)
FIELD_RE = re.compile(r"^\s*-?\s*\*?\*?(\w+)\*?\*?\s*:\s*(.+?)\s*$", re.MULTILINE)


def parse_tickets(text: str) -> list[dict]:
    sections: list[dict] = []
    headers = [m for m in TICKET_HEADER_RE.finditer(text)]
    for i, m in enumerate(headers):
        start = m.end()
        end = headers[i + 1].start() if i + 1 < len(headers) else len(text)
        body = text[start:end]
        fields: dict[str, str] = {}
        for fm in FIELD_RE.finditer(body):
            key = fm.group(1).lower()
            if key in REQUIRED_FIELDS:
                fields.setdefault(key, fm.group(2).strip())
        sections.append({"title": m.group(1).strip(), "fields": fields})
    return sections


def lint(path: Path) -> dict:
    if not path.is_file():
        raise FileNotFoundError(path)
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        return {"ok": False, "reason": "empty file", "tickets": [], "errors": ["empty"]}
    if ZERO_ACTIONABLE_RE.search(text):
        return {
            "ok": True,
            "reason": "explicit zero-actionable declaration",
            "tickets": [],
            "errors": [],
        }
    tickets = parse_tickets(text)
    errors: list[str] = []
    if not tickets:
        errors.append("no ticket sections (### headers) found")
    for t in tickets:
        missing = [f for f in REQUIRED_FIELDS if f not in t["fields"]]
        if missing:
            errors.append(f"ticket '{t['title']}': missing fields {missing}")
    return {
        "ok": len(errors) == 0,
        "reason": "ok" if not errors else "lint errors",
        "tickets": tickets,
        "errors": errors,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("path", help="Path to dev_backlog.md")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = lint(Path(args.path))
    except FileNotFoundError as e:
        print(f"error: file not found: {e}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"ok: {result['ok']}")
        print(f"reason: {result['reason']}")
        print(f"tickets: {len(result['tickets'])}")
        for e in result["errors"]:
            print(f"  ! {e}", file=sys.stderr)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
