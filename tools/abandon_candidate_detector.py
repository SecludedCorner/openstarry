#!/usr/bin/env python3
"""abandon_candidate_detector.py — Flag items stuck in non-Merged states.

Rules (per Master directive 2026-05-24 rule 4):
    - Item in any non-Merged state for >5 cycles: ABANDON_CANDIDATE
    - Item Dispatched but not Acknowledged for >3 cycles: SILENT_DROP_CANDIDATE

Cycles are inferred from item history timestamps and cycle calendar mapping.
For simplicity, this tool accepts an integer "current_cycle_age" computed by
the caller (e.g., coordinator runtime).

Input: promise_state_machine ledger JSON (see promise_state_machine.py).

Usage:
    abandon_candidate_detector.py <ledger> --current-cycle <N>
    abandon_candidate_detector.py --json <ledger> --current-cycle <N>

Exit codes:
    0 = no candidates
    1 = ≥1 candidate flagged
    2 = error
"""
import argparse
import json
import sys
from pathlib import Path

ABANDON_STUCK_CYCLES = 5
SILENT_DROP_CYCLES = 3


def cycle_distance(ratified: str, current: str) -> int:
    """Numeric distance between two cycle IDs like '03-30' -> '03-40'."""
    try:
        a_major, a_minor = (int(x) for x in ratified.split("-"))
        b_major, b_minor = (int(x) for x in current.split("-"))
    except (ValueError, AttributeError):
        return 0
    return (b_major - a_major) * 100 + (b_minor - a_minor)


def detect(ledger: dict, current_cycle: str) -> list[dict]:
    candidates: list[dict] = []
    for item in ledger.get("items", {}).values():
        state = item["current_state"]
        if state in ("Merged", "Validated"):
            continue
        age = cycle_distance(item["ratified_cycle"], current_cycle)
        flag = None
        if state == "Dispatched" and age > SILENT_DROP_CYCLES:
            flag = f"SILENT_DROP_CANDIDATE (Dispatched not Acknowledged for {age} cycles)"
        elif age > ABANDON_STUCK_CYCLES:
            flag = f"ABANDON_CANDIDATE (stuck in {state} for {age} cycles)"
        if flag:
            candidates.append(
                {
                    "id": item["id"],
                    "ratified_cycle": item["ratified_cycle"],
                    "current_state": state,
                    "age_cycles": age,
                    "flag": flag,
                }
            )
    return candidates


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("ledger")
    ap.add_argument("--current-cycle", required=True, help="e.g. 03-42")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        data = json.loads(Path(args.ledger).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    candidates = detect(data, args.current_cycle)
    if args.json:
        print(json.dumps(candidates, indent=2))
    else:
        if not candidates:
            print("no abandon candidates")
        for c in candidates:
            print(f"{c['id']}  ({c['ratified_cycle']} -> {args.current_cycle}; age={c['age_cycles']})  {c['flag']}")
    return 1 if candidates else 0


if __name__ == "__main__":
    sys.exit(main())
