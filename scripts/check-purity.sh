#!/bin/bash
# Purity check — ensures packages/core and packages/sdk don't import forbidden modules.
#
# Rules:
#   1. packages/core/ must NOT import from @openstarry-plugin/* or apps/*
#   2. packages/sdk/ must NOT import from @openstarry/core, @openstarry/shared, @openstarry-plugin/*, or apps/*
#
# Plan49 C49-M4: match only genuine import/from statements. Previous version
# grep'd any substring, producing false positives on error-message strings and
# comments (e.g. `"Install @openstarry-plugin/context-sliding-window..."`). The
# `IMPORT_RX` patterns below require the module name to appear inside a real
# `from '...'` / `import '...'` / `require('...')` clause.

set -e

ERRORS=0

echo "=== Purity Check ==="

# Import-statement regex fragments (single or double quotes).
# - Match "from '<path>'" / "from \"<path>\""
# - Match bare "import '<path>'" / dynamic "import('<path>')"
# - Match CommonJS "require('<path>')"
IMPORT_RX_CORE='(from[[:space:]]+["'\'']|import[[:space:]]*\(?["'\'']|require[[:space:]]*\(["'\''])(@openstarry-plugin|\.\./\.\./apps|apps/)'
IMPORT_RX_SDK='(from[[:space:]]+["'\'']|import[[:space:]]*\(?["'\'']|require[[:space:]]*\(["'\''])(@openstarry/core|@openstarry/shared|@openstarry-plugin|\.\./\.\./apps|apps/)'

# Rule 1: core must not import plugins or apps
CORE_VIOLATIONS=$(grep -rnE "$IMPORT_RX_CORE" packages/core/src/ 2>/dev/null || true)
if [ -n "$CORE_VIOLATIONS" ]; then
  echo ""
  echo "[FAIL] packages/core/ imports forbidden modules:"
  echo "$CORE_VIOLATIONS"
  ERRORS=$((ERRORS + 1))
fi

# Rule 2: sdk must not import core, shared, plugins, or apps
SDK_VIOLATIONS=$(grep -rnE "$IMPORT_RX_SDK" packages/sdk/src/ 2>/dev/null || true)
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
