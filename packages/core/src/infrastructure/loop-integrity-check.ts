/**
 * checkLoopIntegrity — startup diagnostics for the OODA control-loop wiring.
 *
 * Implements Doc 20 §4 (Troubleshooting Broken Loops). The coordination layer
 * inspects the wired registries after plugin load and surfaces broken-loop
 * shapes. NON-FATAL: this emits diagnostics only (warnings) — it never aborts
 * startup, so a false positive costs at most a log line.
 *
 *  - vegetable (植物人):    listeners present but NO providers — the agent can
 *                           receive input but has nothing to think with.
 *  - brain-in-vat (缸中之腦): providers present but NO listeners — the agent can
 *                           think but has no input source. Suppressed when
 *                           `taskOnly` (task agents legitimately have no listener).
 *
 * NOT IMPLEMENTED — Doc 20 §4 bullet 3 ("paralysis": a tool that requires config
 * but received none → startup fails). That check needs a per-plugin/per-tool
 * `requiredConfig` declaration which `PluginManifest` does not currently carry;
 * adding one is a change to a FROZEN SDK interface (requires a Spec Addendum) and
 * is deliberately deferred. Doc 20 carries an honest note to this effect.
 *
 * NEW IN v0.59.6 (Architecture_Documentation/20 closure).
 */

export type LoopIntegrityCode = 'vegetable' | 'brain-in-vat';

export interface LoopIntegrityDiagnostic {
  code: LoopIntegrityCode;
  severity: 'warn';
  message: string;
}

export interface LoopIntegrityInput {
  /** Number of registered providers (想蘊). */
  providerCount: number;
  /** Number of registered listeners (色蘊 — input). */
  listenerCount: number;
  /**
   * When true, suppress the brain-in-vat diagnostic — a pure task-type agent
   * legitimately has providers but no input listener.
   */
  taskOnly?: boolean;
}

/**
 * Inspect the control-loop wiring and return any broken-loop diagnostics.
 * Pure function — deterministic in its inputs, no side effects.
 */
export function checkLoopIntegrity(input: LoopIntegrityInput): LoopIntegrityDiagnostic[] {
  const { providerCount, listenerCount, taskOnly = false } = input;
  const diagnostics: LoopIntegrityDiagnostic[] = [];

  // 植物人 (vegetable): can sense, cannot think.
  if (listenerCount > 0 && providerCount === 0) {
    diagnostics.push({
      code: 'vegetable',
      severity: 'warn',
      message:
        `Loop integrity (植物人/vegetable): ${listenerCount} listener(s) registered but 0 providers — ` +
        `the agent can receive input but has nothing to think with.`,
    });
  }

  // 缸中之腦 (brain-in-vat): can think, no input.
  if (providerCount > 0 && listenerCount === 0 && !taskOnly) {
    diagnostics.push({
      code: 'brain-in-vat',
      severity: 'warn',
      message:
        `Loop integrity (缸中之腦/brain-in-vat): ${providerCount} provider(s) registered but 0 listeners — ` +
        `the agent can think but has no input source (set taskOnly if this is intentional).`,
    });
  }

  return diagnostics;
}

/** Run {@link checkLoopIntegrity} and log each diagnostic via the given logger. */
export function logLoopIntegrity(
  input: LoopIntegrityInput,
  logger: { warn(msg: string): void },
): LoopIntegrityDiagnostic[] {
  const diagnostics = checkLoopIntegrity(input);
  for (const d of diagnostics) {
    logger.warn(d.message);
  }
  return diagnostics;
}
