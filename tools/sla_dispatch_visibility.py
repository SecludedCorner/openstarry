#!/usr/bin/env python3
"""sla_dispatch_visibility.py — Coordinator dispatch SLA + Dev ticket SLA tracker.

SLAs (per Master directive 2026-05-24):
    - Coordinator dispatch: ≤24h from R-team R4 close to Dev task dispatch
    - Dev ticket: ≤7 days from dispatch to merged Dev code

Input: timestamp ledger JSON:
    {
      "dispatches": [
        {
          "id": "FIX-CY30-FIX-C",
          "r4_close_ts": "2026-05-23T03:00:00Z",
          "dispatched_ts": "2026-05-23T21:50:00Z",
          "merged_ts": "2026-05-23T21:55:00Z" | null
        },
        ...
      ]
    }

Usage:
    sla_dispatch_visibility.py <ledger.json>
    sla_dispatch_visibility.py --json <ledger>
    sla_dispatch_visibility.py --as-of <ISO8601> <ledger>

Exit codes:
    0 = all within SLA
    1 = ≥1 SLA breach
    2 = error
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

DISPATCH_SLA_HOURS = 24
DEV_TICKET_SLA_DAYS = 7


def parse_ts(s: str) -> datetime:
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def hours_between(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds() / 3600.0


def evaluate(ledger: dict, as_of: datetime) -> list[dict]:
    out: list[dict] = []
    for d in ledger.get("dispatches", []):
        rec = {"id": d["id"], "breaches": []}
        try:
            r4 = parse_ts(d["r4_close_ts"])
        except (KeyError, ValueError):
            rec["breaches"].append("missing or invalid r4_close_ts")
            out.append(rec)
            continue
        dispatched_ts = d.get("dispatched_ts")
        if dispatched_ts:
            disp = parse_ts(dispatched_ts)
            elapsed = hours_between(r4, disp)
            rec["dispatch_hours"] = round(elapsed, 2)
            if elapsed > DISPATCH_SLA_HOURS:
                rec["breaches"].append(
                    f"dispatch SLA breach: {elapsed:.1f}h > {DISPATCH_SLA_HOURS}h"
                )
        else:
            elapsed = hours_between(r4, as_of)
            rec["dispatch_hours"] = round(elapsed, 2)
            if elapsed > DISPATCH_SLA_HOURS:
                rec["breaches"].append(
                    f"dispatch SLA breach (not yet dispatched): {elapsed:.1f}h > {DISPATCH_SLA_HOURS}h"
                )
        merged_ts = d.get("merged_ts")
        if dispatched_ts:
            disp = parse_ts(dispatched_ts)
            if merged_ts:
                mer = parse_ts(merged_ts)
                days = (mer - disp).total_seconds() / 86400.0
                rec["dev_days"] = round(days, 2)
                if days > DEV_TICKET_SLA_DAYS:
                    rec["breaches"].append(
                        f"dev SLA breach: {days:.1f}d > {DEV_TICKET_SLA_DAYS}d"
                    )
            else:
                days = (as_of - disp).total_seconds() / 86400.0
                rec["dev_days"] = round(days, 2)
                if days > DEV_TICKET_SLA_DAYS:
                    rec["breaches"].append(
                        f"dev SLA breach (not yet merged): {days:.1f}d > {DEV_TICKET_SLA_DAYS}d"
                    )
        out.append(rec)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("ledger")
    ap.add_argument("--as-of")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        data = json.loads(Path(args.ledger).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    as_of = parse_ts(args.as_of) if args.as_of else datetime.now(timezone.utc)
    result = evaluate(data, as_of)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        for r in result:
            line = f"{r['id']}:"
            if "dispatch_hours" in r:
                line += f" dispatch={r['dispatch_hours']:.1f}h"
            if "dev_days" in r:
                line += f" dev={r['dev_days']:.1f}d"
            if r["breaches"]:
                line += "  BREACHES: " + "; ".join(r["breaches"])
            print(line)
    breaches = sum(1 for r in result if r["breaches"])
    return 1 if breaches > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
