#!/usr/bin/env python3
"""inflation_metrics.py — Declared-vs-merged ratio per cycle + 5-cycle rolling avg.

Inflation = declared_items - merged_items (i.e., promises that did not turn
into merged Dev code). Per Master directive 2026-05-24, sustained inflation
>50% triggers operational integrity alert.

Input: ledger JSON file with per-cycle records:
    {
      "cycles": [
        {"cycle": "03-40", "declared": 12, "merged": 1, "abandoned": 0},
        ...
      ]
    }

Usage:
    inflation_metrics.py <ledger.json>
    inflation_metrics.py --json <ledger>
    inflation_metrics.py --alert-threshold 0.5 <ledger>

Exit codes:
    0 = healthy (no alert)
    1 = inflation alert (rolling avg below threshold)
    2 = error
"""
import argparse
import json
import statistics
import sys
from pathlib import Path


def merge_ratio(rec: dict) -> float:
    declared = rec.get("declared", 0)
    merged = rec.get("merged", 0)
    if declared <= 0:
        return 1.0  # nothing declared, nothing to fail
    return merged / declared


def compute(ledger: dict, window: int = 5) -> dict:
    cycles = ledger.get("cycles", [])
    if not cycles:
        return {"per_cycle": [], "rolling_avg": [], "latest_avg": None}
    per_cycle = []
    for rec in cycles:
        per_cycle.append(
            {
                "cycle": rec.get("cycle", "unknown"),
                "declared": rec.get("declared", 0),
                "merged": rec.get("merged", 0),
                "abandoned": rec.get("abandoned", 0),
                "merge_ratio": round(merge_ratio(rec), 4),
            }
        )
    rolling: list[dict] = []
    for i in range(len(per_cycle)):
        win = per_cycle[max(0, i - window + 1) : i + 1]
        avg = statistics.mean(r["merge_ratio"] for r in win)
        rolling.append({"cycle": per_cycle[i]["cycle"], "rolling_avg": round(avg, 4)})
    return {
        "per_cycle": per_cycle,
        "rolling_avg": rolling,
        "latest_avg": rolling[-1]["rolling_avg"] if rolling else None,
        "window": window,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("ledger", help="Path to ledger JSON")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--alert-threshold", type=float, default=0.5)
    ap.add_argument("--window", type=int, default=5)
    args = ap.parse_args()
    try:
        ledger = json.loads(Path(args.ledger).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    result = compute(ledger, window=args.window)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        for rec in result["per_cycle"]:
            print(
                f"{rec['cycle']}: declared={rec['declared']:>3}  merged={rec['merged']:>3}  ratio={rec['merge_ratio']:.2%}"
            )
        if result["latest_avg"] is not None:
            print(f"\nlatest {result['window']}-cycle rolling avg: {result['latest_avg']:.2%}")
    if result["latest_avg"] is not None and result["latest_avg"] < args.alert_threshold:
        print(
            f"ALERT: rolling avg {result['latest_avg']:.2%} below threshold {args.alert_threshold:.2%}",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
