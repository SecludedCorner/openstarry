"""Pytest conformance tests for Sprint A execution-enforcement tools (#314).

Covers smoke + behavior tests for:
    - source_diff_check
    - dev_backlog_lint
    - inflation_metrics
    - promise_state_machine
    - abandon_candidate_detector
    - sla_dispatch_visibility
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

TOOLS_DIR = Path(__file__).resolve().parent.parent


def run(*args, expect_code=None) -> subprocess.CompletedProcess:
    cmd = [sys.executable, str(TOOLS_DIR / args[0]), *args[1:]]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if expect_code is not None:
        assert proc.returncode == expect_code, (
            f"expected {expect_code}, got {proc.returncode}\nstdout: {proc.stdout}\nstderr: {proc.stderr}"
        )
    return proc


# ─── source_diff_check ───────────────────────────────────────────────────

def test_source_diff_identical_dirs_doc_only(tmp_path):
    a = tmp_path / "a"
    b = tmp_path / "b"
    (a / "src").mkdir(parents=True)
    (b / "src").mkdir(parents=True)
    (a / "src" / "file.ts").write_text("hello")
    (b / "src" / "file.ts").write_text("hello")
    # excluded files should not count
    (a / "package-lock.json").write_text("{}")
    (b / "package-lock.json").write_text('{"different": true}')
    proc = run("source_diff_check.py", "--json", str(a), str(b))
    assert proc.returncode == 0
    result = json.loads(proc.stdout)
    assert result["total_diff_count"] == 0


def test_source_diff_strict_doc_only_exits_1(tmp_path):
    a = tmp_path / "a"
    b = tmp_path / "b"
    a.mkdir()
    b.mkdir()
    (a / "file.txt").write_text("same")
    (b / "file.txt").write_text("same")
    proc = run("source_diff_check.py", "--strict", str(a), str(b))
    assert proc.returncode == 1


def test_source_diff_detects_real_change(tmp_path):
    a = tmp_path / "a"
    b = tmp_path / "b"
    a.mkdir()
    b.mkdir()
    (a / "file.ts").write_text("x")
    (b / "file.ts").write_text("y")
    proc = run("source_diff_check.py", "--json", str(a), str(b))
    assert proc.returncode == 0
    result = json.loads(proc.stdout)
    assert result["total_diff_count"] == 1
    assert result["changed"] == ["file.ts"]


def test_source_diff_excludes_audit_trail(tmp_path):
    a = tmp_path / "a"
    b = tmp_path / "b"
    a.mkdir()
    b.mkdir()
    (a / "audit-trail-test-agent.jsonl").write_text("v1")
    (b / "audit-trail-test-agent.jsonl").write_text("v2")
    proc = run("source_diff_check.py", "--json", str(a), str(b))
    result = json.loads(proc.stdout)
    assert result["total_diff_count"] == 0


# ─── dev_backlog_lint ───────────────────────────────────────────────────

def test_dev_backlog_explicit_zero_actionable(tmp_path):
    f = tmp_path / "dev_backlog.md"
    f.write_text("# Backlog\n\n0 actionable items + rationale: LINNAEUS S3 anti-proliferation cycle.\n")
    proc = run("dev_backlog_lint.py", "--json", str(f))
    result = json.loads(proc.stdout)
    assert result["ok"]


def test_dev_backlog_complete_ticket_passes(tmp_path):
    f = tmp_path / "dev_backlog.md"
    f.write_text(
        "# Backlog\n\n"
        "### DT-42-A FIX-cy30 const refactor\n"
        "- file: openstarry_plugin/guide-character-init/src/index.ts:44-49\n"
        "- spec: let -> const ternary refactor\n"
        "- owner: dev-team\n"
        "- accept: ESLint passes, behavior unchanged\n"
        "- target: cycle 03-42\n"
    )
    proc = run("dev_backlog_lint.py", "--json", str(f))
    result = json.loads(proc.stdout)
    assert result["ok"], result


def test_dev_backlog_missing_field_fails(tmp_path):
    f = tmp_path / "dev_backlog.md"
    f.write_text(
        "# Backlog\n\n"
        "### DT-42-B incomplete ticket\n"
        "- file: src/foo.ts:10\n"
        "- owner: dev-team\n"
        # missing spec, accept, target
    )
    proc = run("dev_backlog_lint.py", "--json", str(f))
    assert proc.returncode == 1


def test_dev_backlog_empty_file_fails(tmp_path):
    f = tmp_path / "dev_backlog.md"
    f.write_text("")
    proc = run("dev_backlog_lint.py", str(f))
    assert proc.returncode == 1


# ─── inflation_metrics ─────────────────────────────────────────────────

def test_inflation_healthy_passes(tmp_path):
    ledger = tmp_path / "ledger.json"
    ledger.write_text(
        json.dumps({"cycles": [{"cycle": f"03-{i}", "declared": 10, "merged": 8} for i in range(35, 41)]})
    )
    proc = run("inflation_metrics.py", "--json", str(ledger))
    assert proc.returncode == 0
    result = json.loads(proc.stdout)
    assert result["latest_avg"] == pytest.approx(0.8)


def test_inflation_alert_below_threshold(tmp_path):
    ledger = tmp_path / "ledger.json"
    ledger.write_text(
        json.dumps({"cycles": [{"cycle": f"03-{i}", "declared": 10, "merged": 1} for i in range(35, 41)]})
    )
    proc = run("inflation_metrics.py", str(ledger))
    assert proc.returncode == 1


def test_inflation_rolling_window(tmp_path):
    ledger = tmp_path / "ledger.json"
    ledger.write_text(
        json.dumps(
            {
                "cycles": [
                    {"cycle": "03-35", "declared": 10, "merged": 0},
                    {"cycle": "03-36", "declared": 10, "merged": 10},
                    {"cycle": "03-37", "declared": 10, "merged": 10},
                    {"cycle": "03-38", "declared": 10, "merged": 10},
                    {"cycle": "03-39", "declared": 10, "merged": 10},
                ]
            }
        )
    )
    proc = run("inflation_metrics.py", "--json", str(ledger))
    result = json.loads(proc.stdout)
    # 5-cycle window over [0, 1, 1, 1, 1] avg = 0.8
    assert result["latest_avg"] == pytest.approx(0.8)


# ─── promise_state_machine ─────────────────────────────────────────────

def test_psm_init_and_add(tmp_path):
    ledger = tmp_path / "ledger.json"
    run("promise_state_machine.py", "init", str(ledger), expect_code=0)
    run(
        "promise_state_machine.py", "add", str(ledger),
        "--id", "FIX-CY30-FIX-C", "--cycle", "03-30",
        expect_code=0,
    )
    proc = run("promise_state_machine.py", "status", str(ledger), "--json")
    items = json.loads(proc.stdout)
    assert len(items) == 1
    assert items[0]["current_state"] == "Promised"


def test_psm_forward_transition(tmp_path):
    ledger = tmp_path / "ledger.json"
    run("promise_state_machine.py", "init", str(ledger), expect_code=0)
    run("promise_state_machine.py", "add", str(ledger), "--id", "X", "--cycle", "03-30", expect_code=0)
    run("promise_state_machine.py", "transition", str(ledger), "--id", "X", "--to", "Dispatched", expect_code=0)
    run("promise_state_machine.py", "transition", str(ledger), "--id", "X", "--to", "Merged", expect_code=0)
    proc = run("promise_state_machine.py", "status", str(ledger), "--id", "X", "--json")
    items = json.loads(proc.stdout)
    assert items[0]["current_state"] == "Merged"
    assert len(items[0]["history"]) == 3  # add + 2 transitions


def test_psm_backward_transition_blocked(tmp_path):
    ledger = tmp_path / "ledger.json"
    run("promise_state_machine.py", "init", str(ledger), expect_code=0)
    run("promise_state_machine.py", "add", str(ledger), "--id", "X", "--cycle", "03-30", expect_code=0)
    run("promise_state_machine.py", "transition", str(ledger), "--id", "X", "--to", "Merged", expect_code=0)
    proc = run("promise_state_machine.py", "transition", str(ledger), "--id", "X", "--to", "InProgress")
    assert proc.returncode == 1  # backwards


# ─── abandon_candidate_detector ────────────────────────────────────────

def test_abandon_detects_stuck_item(tmp_path):
    ledger = tmp_path / "ledger.json"
    ledger.write_text(json.dumps({
        "items": {
            "X": {
                "id": "X",
                "ratified_cycle": "03-30",
                "current_state": "InProgress",
                "history": [],
            }
        }
    }))
    proc = run("abandon_candidate_detector.py", "--json", str(ledger), "--current-cycle", "03-40")
    candidates = json.loads(proc.stdout)
    assert len(candidates) == 1
    assert "ABANDON_CANDIDATE" in candidates[0]["flag"]
    assert proc.returncode == 1


def test_abandon_ignores_merged(tmp_path):
    ledger = tmp_path / "ledger.json"
    ledger.write_text(json.dumps({
        "items": {
            "X": {
                "id": "X",
                "ratified_cycle": "03-30",
                "current_state": "Merged",
                "history": [],
            }
        }
    }))
    proc = run("abandon_candidate_detector.py", "--json", str(ledger), "--current-cycle", "03-40")
    assert proc.returncode == 0
    candidates = json.loads(proc.stdout)
    assert candidates == []


def test_abandon_silent_drop_dispatched_3_cycles(tmp_path):
    ledger = tmp_path / "ledger.json"
    ledger.write_text(json.dumps({
        "items": {
            "Y": {
                "id": "Y",
                "ratified_cycle": "03-38",
                "current_state": "Dispatched",
                "history": [],
            }
        }
    }))
    proc = run("abandon_candidate_detector.py", "--json", str(ledger), "--current-cycle", "03-42")
    candidates = json.loads(proc.stdout)
    assert len(candidates) == 1
    assert "SILENT_DROP_CANDIDATE" in candidates[0]["flag"]


# ─── sla_dispatch_visibility ─────────────────────────────────────────

def test_sla_within(tmp_path):
    ledger = tmp_path / "ledger.json"
    ledger.write_text(json.dumps({
        "dispatches": [
            {
                "id": "X",
                "r4_close_ts": "2026-05-23T00:00:00Z",
                "dispatched_ts": "2026-05-23T18:00:00Z",
                "merged_ts": "2026-05-25T00:00:00Z",
            }
        ]
    }))
    proc = run("sla_dispatch_visibility.py", "--json", str(ledger))
    result = json.loads(proc.stdout)
    assert result[0]["breaches"] == []
    assert proc.returncode == 0


def test_sla_dispatch_breach(tmp_path):
    ledger = tmp_path / "ledger.json"
    ledger.write_text(json.dumps({
        "dispatches": [
            {
                "id": "X",
                "r4_close_ts": "2026-05-20T00:00:00Z",
                "dispatched_ts": "2026-05-22T00:00:00Z",  # 48h > 24h
                "merged_ts": None,
            }
        ]
    }))
    proc = run(
        "sla_dispatch_visibility.py",
        "--as-of", "2026-05-23T00:00:00Z",
        "--json", str(ledger),
    )
    result = json.loads(proc.stdout)
    assert any("dispatch SLA breach" in b for b in result[0]["breaches"])
    assert proc.returncode == 1


def test_sla_dev_ticket_breach(tmp_path):
    ledger = tmp_path / "ledger.json"
    ledger.write_text(json.dumps({
        "dispatches": [
            {
                "id": "Y",
                "r4_close_ts": "2026-05-10T00:00:00Z",
                "dispatched_ts": "2026-05-10T12:00:00Z",
                "merged_ts": "2026-05-20T00:00:00Z",  # ~10 days > 7
            }
        ]
    }))
    proc = run("sla_dispatch_visibility.py", "--json", str(ledger))
    result = json.loads(proc.stdout)
    assert any("dev SLA breach" in b for b in result[0]["breaches"])
