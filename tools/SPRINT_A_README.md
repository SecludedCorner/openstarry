# Sprint A — Execution-Enforcement Tools (#314)

Per Master directive 2026-05-24 operational integrity pivot. 6 tools live as
CLI scripts in `tools/` and feed into the coordinator G5 gate.

## Tools

| Tool | Role | Exit Code Contract |
|------|------|--------------------|
| `source_diff_check.py` | Source-relevant diff between 2 release dirs | `0` = diff present, `1` = doc-only (when `--strict`), `2` = error |
| `dev_backlog_lint.py` | Validate cycle `dev_backlog.md` format | `0` = pass, `1` = lint failure |
| `inflation_metrics.py` | Declared-vs-merged ratio + 5-cycle rolling avg | `0` = healthy, `1` = below threshold |
| `promise_state_machine.py` | Per-item Promised→…→Validated state ledger | `0` = ok, `1` = invalid transition |
| `abandon_candidate_detector.py` | Flag items stuck >5 cycles (or >3 cycles Dispatched) | `0` = none, `1` = ≥1 candidate |
| `sla_dispatch_visibility.py` | Coordinator ≤24h + Dev ≤7d SLA tracker | `0` = within SLA, `1` = breach |

Each tool exposes `--json` for machine-readable output and exits non-zero on
failure so it can plug into shell pipelines and CI gates.

## Coordinator G5 gate integration

Suggested ordering when closing a cycle:

```bash
# 1. Reject empty version bumps unless explicitly doc-only
python tools/source_diff_check.py --strict release/cycle03-N_vX.Y.Z release/cycle03-(N-1)_vX.Y.(Z-1) \
  || grep -q '^title:.*[Dd]oc-[Oo]nly' release/cycle03-N_vX.Y.Z/delivery_report.md \
  || { echo "REJECT: source-byte empty release without doc-only declaration"; exit 1; }

# 2. R-team R4 deliverable lint
python tools/dev_backlog_lint.py "claude research/research record/cycle03-N/deliver/dev_backlog.md" \
  || { echo "REJECT: dev_backlog.md fails lint"; exit 1; }

# 3. State machine update + SLA check
python tools/promise_state_machine.py status ledger.json --json > /tmp/state.json
python tools/sla_dispatch_visibility.py timestamps.json
python tools/abandon_candidate_detector.py ledger.json --current-cycle 03-N

# 4. Weekly inflation report (Master review)
python tools/inflation_metrics.py inflation_ledger.json
```

## Ledger schemas

### promise_state_machine ledger

```json
{
  "items": {
    "FIX-CY30-FIX-C": {
      "id": "FIX-CY30-FIX-C",
      "ratified_cycle": "03-30",
      "current_state": "Merged",
      "history": [
        {"ts": "2026-05-23T21:55:00Z", "from": "InProgress", "to": "Merged", "by": "dev-team"}
      ]
    }
  }
}
```

### inflation_metrics ledger

```json
{
  "cycles": [
    {"cycle": "03-40", "declared": 12, "merged": 1, "abandoned": 0},
    {"cycle": "03-41", "declared": 8,  "merged": 4, "abandoned": 1}
  ]
}
```

### sla_dispatch_visibility ledger

```json
{
  "dispatches": [
    {
      "id": "FIX-CY30-FIX-C",
      "r4_close_ts": "2026-05-23T03:00:00Z",
      "dispatched_ts": "2026-05-23T21:50:00Z",
      "merged_ts": "2026-05-23T21:55:00Z"
    }
  ]
}
```

## Tests

```bash
cd agent_dev/openstarry/tools
python -m pytest tests/test_dev_tools_sprint_a.py -v
```

## State machine forward-only invariant

The state machine enforces MR-12 forward-only progression:

```
Promised → Dispatched → Acknowledged → InProgress → Merged → Validated
```

Backwards transitions require `--force` and are recorded in history with the
explicit reverse direction (so audit trail preserves the regression event).
