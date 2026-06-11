#!/usr/bin/env python3
"""promise_state_machine.py — Per-ratified-R3-item state tracker.

State machine:
    Promised -> Dispatched -> Acknowledged -> InProgress -> Merged -> Validated

Transitions are forward-only (per MR-12). Backwards transitions emit an audit
entry but require explicit --force.

Persistent JSON ledger structure:
    {
      "items": {
        "<id>": {
          "id": "FIX-CY30-FIX-C",
          "ratified_cycle": "03-30",
          "current_state": "Merged",
          "history": [
            {"ts": "2026-05-23T21:55:00Z", "from": "InProgress", "to": "Merged", "by": "dev-team"},
            ...
          ]
        }
      }
    }

Usage:
    promise_state_machine.py init <ledger>
    promise_state_machine.py add <ledger> --id <ID> --cycle <CY> [--state Promised]
    promise_state_machine.py transition <ledger> --id <ID> --to <STATE> [--by <AGENT>]
    promise_state_machine.py status <ledger> [--id <ID>] [--state <STATE>]
    promise_state_machine.py --json status <ledger>

Exit codes:
    0 = ok
    1 = invalid transition
    2 = error
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

STATES = ("Promised", "Dispatched", "Acknowledged", "InProgress", "Merged", "Validated")
ORDER = {s: i for i, s in enumerate(STATES)}


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load(path: Path) -> dict:
    if not path.exists():
        return {"items": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def save(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def cmd_init(args) -> int:
    path = Path(args.ledger)
    if path.exists():
        print(f"error: ledger already exists: {path}", file=sys.stderr)
        return 2
    save(path, {"items": {}})
    print(f"initialized empty ledger at {path}")
    return 0


def cmd_add(args) -> int:
    path = Path(args.ledger)
    data = load(path)
    if args.id in data["items"]:
        print(f"error: item exists: {args.id}", file=sys.stderr)
        return 2
    if args.state not in STATES:
        print(f"error: invalid state '{args.state}'", file=sys.stderr)
        return 2
    data["items"][args.id] = {
        "id": args.id,
        "ratified_cycle": args.cycle,
        "current_state": args.state,
        "history": [{"ts": utcnow(), "from": None, "to": args.state, "by": "add"}],
    }
    save(path, data)
    print(f"added {args.id} ({args.cycle}) at state {args.state}")
    return 0


def cmd_transition(args) -> int:
    path = Path(args.ledger)
    data = load(path)
    if args.id not in data["items"]:
        print(f"error: unknown item: {args.id}", file=sys.stderr)
        return 2
    if args.to not in STATES:
        print(f"error: invalid target state '{args.to}'", file=sys.stderr)
        return 2
    item = data["items"][args.id]
    cur = item["current_state"]
    if ORDER[args.to] <= ORDER[cur] and not args.force:
        print(
            f"error: invalid transition {cur} -> {args.to} (forward-only; use --force)",
            file=sys.stderr,
        )
        return 1
    item["history"].append({"ts": utcnow(), "from": cur, "to": args.to, "by": args.by or "unknown"})
    item["current_state"] = args.to
    save(path, data)
    print(f"{args.id}: {cur} -> {args.to}")
    return 0


def cmd_status(args) -> int:
    path = Path(args.ledger)
    data = load(path)
    items = list(data["items"].values())
    if args.id:
        items = [it for it in items if it["id"] == args.id]
    if args.state:
        items = [it for it in items if it["current_state"] == args.state]
    if args.json:
        print(json.dumps(items, indent=2))
    else:
        for it in items:
            print(f"{it['id']}  ({it['ratified_cycle']})  {it['current_state']}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_init = sub.add_parser("init")
    p_init.add_argument("ledger")
    p_init.set_defaults(func=cmd_init)
    p_add = sub.add_parser("add")
    p_add.add_argument("ledger")
    p_add.add_argument("--id", required=True)
    p_add.add_argument("--cycle", required=True)
    p_add.add_argument("--state", default="Promised")
    p_add.set_defaults(func=cmd_add)
    p_tr = sub.add_parser("transition")
    p_tr.add_argument("ledger")
    p_tr.add_argument("--id", required=True)
    p_tr.add_argument("--to", required=True)
    p_tr.add_argument("--by")
    p_tr.add_argument("--force", action="store_true")
    p_tr.set_defaults(func=cmd_transition)
    p_st = sub.add_parser("status")
    p_st.add_argument("ledger")
    p_st.add_argument("--id")
    p_st.add_argument("--state")
    p_st.add_argument("--json", action="store_true")
    p_st.set_defaults(func=cmd_status)
    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
