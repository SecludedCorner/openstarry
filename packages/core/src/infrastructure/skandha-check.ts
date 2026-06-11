/**
 * checkSkandhaCorrespondence — verify plugin manifest.skandha against actual PluginHooks.
 * Implements 18 sigma-constraints from Doc #49 (Skandha Soft Constraints).
 * NEW IN v0.33.0-alpha (Plan33, RES-D2-3).
 *
 * Always executes (no config toggle — D3b-R1, 24/24 vote).
 * Output controlled by logger level (dual-layer config).
 *
 * Enforcement levels:
 * - L2 (default): Overclaimed → warn, Undeclared → info
 * - L3: L2 + emit skandha:mismatch event on EventBus (fires only when violations > 0)
 */

import type { PluginManifest, PluginHooks, Skandha } from "@openstarry/sdk";
import { hasSkandha } from "@openstarry/sdk";

export interface SkandhaViolation {
  constraintId: string;      // 'sigma-1' through 'sigma-17' (plus 'sigma-9b')
  severity: 'INFO' | 'WARN';
  pluginName: string;
  message: string;
}

interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
}

/** Check if manifest declares a specific skandha. */
function declares(manifest: PluginManifest, s: Skandha): boolean {
  return hasSkandha(manifest, s);
}

/** Check if hooks has non-empty array or truthy value for a field. */
function hasHook(hooks: PluginHooks, field: keyof PluginHooks): boolean {
  const val = hooks[field];
  if (val == null) return false;
  if (Array.isArray(val)) return val.length > 0;
  return true;
}

/**
 * Check plugin manifest.skandha against actual PluginHooks registration.
 * Implements 18 sigma-constraints from Doc #49.
 *
 * @returns Array of violations found (empty = all consistent)
 */
export function checkSkandhaCorrespondence(
  manifest: PluginManifest,
  hooks: PluginHooks,
  logger: Logger,
): SkandhaViolation[] {
  const violations: SkandhaViolation[] = [];
  const name = manifest.name;

  // Helper to record a violation
  function v(id: string, severity: 'INFO' | 'WARN', msg: string): void {
    violations.push({ constraintId: id, severity, pluginName: name, message: msg });
    if (severity === 'WARN') {
      logger.warn(`[${id}] ${name}: ${msg}`);
    } else {
      logger.info(`[${id}] ${name}: ${msg}`);
    }
  }

  // Determine what's declared and what's hooked
  const skandha = manifest.skandha;
  const skandhaArr: Skandha[] = skandha == null
    ? []
    : Array.isArray(skandha)
      ? [...skandha]
      : [skandha];
  const hasAnySkandha = skandhaArr.length > 0;

  const hasAnyHook =
    hasHook(hooks, 'providers') || hasHook(hooks, 'tools') || hasHook(hooks, 'listeners') ||
    hasHook(hooks, 'ui') || hasHook(hooks, 'guides') || hasHook(hooks, 'vedanaSensors') ||
    hasHook(hooks, 'gearArbiters') || hasHook(hooks, 'volition') || hasHook(hooks, 'monitors') ||
    hasHook(hooks, 'auditor') || hasHook(hooks, 'contextManager');

  // === Undeclared Hook constraints (sigma-1 through sigma-5) ===
  // Declared skandha but no corresponding hook

  // sigma-1: vedana declared → vedanaSensors expected
  if (declares(manifest, 'vedana') && !hasHook(hooks, 'vedanaSensors')) {
    v('sigma-1', 'INFO', 'Declares vedana but no vedanaSensors hook registered');
  }

  // sigma-2: samjna declared → providers / gearArbiters / contextManager expected
  if (declares(manifest, 'samjna') &&
      !hasHook(hooks, 'providers') && !hasHook(hooks, 'gearArbiters') && !hasHook(hooks, 'contextManager')) {
    v('sigma-2', 'INFO', 'Declares samjna but no providers/gearArbiters/contextManager hook registered');
  }

  // sigma-3: samskara declared → tools expected
  if (declares(manifest, 'samskara') && !hasHook(hooks, 'tools')) {
    v('sigma-3', 'INFO', 'Declares samskara but no tools hook registered');
  }

  // sigma-4: rupa declared → ui / listeners expected
  if (declares(manifest, 'rupa') && !hasHook(hooks, 'ui') && !hasHook(hooks, 'listeners')) {
    v('sigma-4', 'INFO', 'Declares rupa but no ui/listeners hook registered');
  }

  // sigma-5: vijnana declared → guides / auditor / monitors expected
  if (declares(manifest, 'vijnana') &&
      !hasHook(hooks, 'guides') && !hasHook(hooks, 'auditor') && !hasHook(hooks, 'monitors')) {
    v('sigma-5', 'INFO', 'Declares vijnana but no guides/auditor/monitors hook registered');
  }

  // === Overclaimed Skandha constraints (sigma-6 through sigma-12) ===
  // Hook present but corresponding skandha not declared

  // sigma-6: tools present → samskara expected
  if (hasHook(hooks, 'tools') && !declares(manifest, 'samskara')) {
    v('sigma-6', 'WARN', 'Registers tools but does not declare samskara');
  }

  // sigma-7: ui present → rupa expected
  if (hasHook(hooks, 'ui') && !declares(manifest, 'rupa')) {
    v('sigma-7', 'WARN', 'Registers ui but does not declare rupa');
  }

  // sigma-8: listeners present → rupa expected
  if (hasHook(hooks, 'listeners') && !declares(manifest, 'rupa')) {
    v('sigma-8', 'WARN', 'Registers listeners but does not declare rupa');
  }

  // sigma-9: providers present → samjna expected
  if (hasHook(hooks, 'providers') && !declares(manifest, 'samjna')) {
    v('sigma-9', 'WARN', 'Registers providers but does not declare samjna');
  }

  // sigma-9b: contextManager present → samjna expected (Plan32 W6 addition, RES-D2-3)
  if (hasHook(hooks, 'contextManager') && !declares(manifest, 'samjna')) {
    v('sigma-9b', 'WARN', 'Registers contextManager but does not declare samjna');
  }

  // sigma-10: auditor present → vijnana expected
  if (hasHook(hooks, 'auditor') && !declares(manifest, 'vijnana')) {
    v('sigma-10', 'WARN', 'Registers auditor but does not declare vijnana');
  }

  // sigma-11: monitors present → vijnana expected
  if (hasHook(hooks, 'monitors') && !declares(manifest, 'vijnana')) {
    v('sigma-11', 'WARN', 'Registers monitors but does not declare vijnana');
  }

  // sigma-12: guides present → vijnana expected
  if (hasHook(hooks, 'guides') && !declares(manifest, 'vijnana')) {
    v('sigma-12', 'WARN', 'Registers guides but does not declare vijnana');
  }

  // === Structural constraints (sigma-13 through sigma-17) ===

  // sigma-13: empty skandha array
  if (hasAnySkandha === false && hasAnyHook) {
    // This case is covered by sigma-15; sigma-13 fires only if truly empty AND no hooks
  }
  if (skandhaArr.length === 0 && !hasAnyHook) {
    v('sigma-13', 'INFO', 'Empty skandha declaration and no hooks registered');
  }

  // sigma-14: no hooks registered at all (but has skandha)
  if (!hasAnyHook && hasAnySkandha) {
    v('sigma-14', 'INFO', 'Declares skandha but no hooks registered');
  }

  // sigma-15: hooks present but no skandha declared
  if (hasAnyHook && !hasAnySkandha) {
    v('sigma-15', 'WARN', 'Registers hooks but declares no skandha');
  }

  // sigma-16: klesha hook (future) → vijnana expected
  // Currently PluginHooks has no 'klesha' field — reserved for future
  // if (hasHook(hooks, 'klesha') && !declares(manifest, 'vijnana')) {
  //   v('sigma-16', 'WARN', 'Registers klesha but does not declare vijnana');
  // }

  // sigma-17: volition hook → samskara or vijnana expected
  if (hasHook(hooks, 'volition') && !declares(manifest, 'samskara') && !declares(manifest, 'vijnana')) {
    v('sigma-17', 'WARN', 'Registers volition but does not declare samskara or vijnana');
  }

  return violations;
}
