#!/bin/bash
# Purity check — ensures packages/core and packages/sdk don't import forbidden modules.
#
# Rules:
#   1. packages/core/ must NOT import from @openstarry-plugin/* or apps/*
#   2. packages/sdk/ must NOT import from @openstarry/core, @openstarry/shared, @openstarry-plugin/*, or apps/*

set -e

ERRORS=0

echo "=== Purity Check ==="

# Rule 1: core must not import plugins or apps
CORE_VIOLATIONS=$(grep -rn "@openstarry-plugin\|from ['\"]\.\.\/\.\.\/apps\|from ['\"]apps/" packages/core/src/ 2>/dev/null || true)
if [ -n "$CORE_VIOLATIONS" ]; then
  echo ""
  echo "[FAIL] packages/core/ imports forbidden modules:"
  echo "$CORE_VIOLATIONS"
  ERRORS=$((ERRORS + 1))
fi

# Rule 2: sdk must not import core, shared, plugins, or apps
SDK_VIOLATIONS=$(grep -rn "@openstarry/core\|@openstarry/shared\|@openstarry-plugin\|from ['\"]\.\.\/\.\.\/apps\|from ['\"]apps/" packages/sdk/src/ 2>/dev/null || true)
if [ -n "$SDK_VIOLATIONS" ]; then
  echo ""
  echo "[FAIL] packages/sdk/ imports forbidden modules:"
  echo "$SDK_VIOLATIONS"
  ERRORS=$((ERRORS + 1))
fi

if [ $ERRORS -eq 0 ]; then
  echo "[PASS] All purity checks passed."
  exit 0
else
  echo ""
  echo "[FAIL] $ERRORS purity violation(s) found."
  exit 1
fi
