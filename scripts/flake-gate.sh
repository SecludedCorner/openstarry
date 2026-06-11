#!/bin/bash
# Plan49 C49-M1d — plugin-install flake-history gate (SHOULD).
#
# Runs the plugin-install test files N iterations; any failure fails the gate.
# Intended to be invoked by CI; no GitHub Actions / other-CI wiring is bundled
# here (the project has no CI pipeline at the time of Plan49 delivery).
#
# Usage:
#   bash scripts/flake-gate.sh [ITERATIONS]
#
# Default ITERATIONS = 50 (matches the Plan49 C49-M1b MUST gate target).
# Shorter local smoke: bash scripts/flake-gate.sh 5
#
# Exit codes:
#   0 — all iterations PASS
#   1 — at least one iteration failed (gate tripped)
#   2 — usage error
#
# The script assumes it is invoked from the package root (where package.json +
# pnpm-workspace.yaml live). Checks $PWD for package.json to fail fast otherwise.

set -eu

ITERATIONS="${1:-50}"

if ! [[ "$ITERATIONS" =~ ^[0-9]+$ ]] || [ "$ITERATIONS" -lt 1 ]; then
  echo "[flake-gate] ERROR: ITERATIONS must be a positive integer (got '$ITERATIONS')" >&2
  exit 2
fi

if [ ! -f "package.json" ]; then
  echo "[flake-gate] ERROR: run from the package root (package.json not found in \$PWD)" >&2
  exit 2
fi

TARGETS=(
  "apps/runner/__tests__/utils/plugin-installer.test.ts"
  "apps/runner/__tests__/commands/plugin-install.test.ts"
)

echo "[flake-gate] Plan49 C49-M1d — plugin-install 50-iter gate"
echo "[flake-gate] iterations: $ITERATIONS; targets: ${TARGETS[*]}"

FAILS=0

for i in $(seq 1 "$ITERATIONS"); do
  if ! pnpm test "${TARGETS[@]}" > /tmp/flake-gate-iter.log 2>&1; then
    FAILS=$((FAILS + 1))
    echo "[flake-gate] iter $i: FAIL"
    tail -30 /tmp/flake-gate-iter.log
    # Bail early — flake gate semantics are zero tolerance.
    echo "[flake-gate] Gate tripped on iter $i; aborting."
    exit 1
  fi
  echo "[flake-gate] iter $i/$ITERATIONS: pass"
done

echo "[flake-gate] all $ITERATIONS iterations PASS — flake gate clean."
exit 0
