/**
 * zod-gate / hook-registry-schemas — Plan51 Module 4 (rollout #4).
 *
 * **D-§5-E binding (21/2; DSS-C4 2 dissent §10)**: hook-registry =
 * **1 module + 2 schema artefacts** per DARWIN Strategy/Registry pattern:
 *
 *   - `HookRegistration`: Registry-pattern data structure (registration metadata,
 *     what plugin declared which hooks, version) — STRICT from start.
 *   - `HookContract<I, O>`: Strategy-pattern dispatch contract (per-event-type,
 *     dispatch the registered handler with input/output contract) — AUDITED
 *     initially.
 *
 * Two patterns sharing one registry data structure; different lifecycle phases
 * (registration at boot/hot-reload; dispatch at runtime per event).
 *
 * @see openstarry_doc/Technical_Specifications/Plan51_Zod_Gate_Binding.md §4.4
 */

import { z, type ZodType } from 'zod';
import { validateInbound, assertOutbound } from './middleware.js';

/** Closed enumeration of recognised hook-types (extensible via registry). */
export const HOOK_TYPES = [
  'onCheckpoint',
  'onRestore',
  'onLoad',
  'onUnload',
  'onSchemaDrift',
  'onAuditEmit',
] as const;
export type HookType = (typeof HOOK_TYPES)[number];

/** Registration data structure (Registry pattern). STRICT from start. */
export const HookRegistration = z.object({
  plugin_name: z.string().min(1),
  hook_type: z.enum(HOOK_TYPES),
  /** Declared at plugin load; semver-shape but kept as string for forward-compat. */
  plugin_version: z.string().min(1),
  /** Schema version of the contract this hook honours (schema-drift defense). */
  contract_version: z.literal(1),
  registered_at: z.number().int().nonnegative(),
});
export type HookRegistrationType = z.infer<typeof HookRegistration>;

/**
 * Strategy-pattern dispatch contract — parameterised on input/output Zod types.
 * Returns a builder that produces a runtime guard (`dispatch`) which validates
 * input on the way in and asserts output on the way out (or returns a drift
 * result for audited-mode).
 */
export function hookContract<I, O>(input: ZodType<I>, output: ZodType<O>) {
  return {
    /** Validate dispatch input (audited mode default). */
    parseInput(value: unknown, context: string) {
      return validateInbound(input, value, `hook-registry.${context}.input`);
    },
    /** Assert dispatch output (we control the producer; throw on mismatch). */
    assertOutput(value: unknown, context: string): O {
      return assertOutbound(output, value, `hook-registry.${context}.output`);
    },
  };
}

/** In-memory registry (Registry pattern data structure). */
export class HookRegistry {
  private readonly registrations = new Map<string, HookRegistrationType>();

  /** Register a hook (STRICT validation; throws on malformed registration). */
  register(raw: unknown): HookRegistrationType {
    // STRICT-from-start per §4.4 runtime-guard table.
    const registration = assertOutbound(HookRegistration, raw, 'hook-registry.register');
    const key = `${registration.plugin_name}:${registration.hook_type}`;
    this.registrations.set(key, registration);
    return registration;
  }

  /** Lookup; returns null when absent. */
  lookup(plugin_name: string, hook_type: HookType): HookRegistrationType | null {
    return this.registrations.get(`${plugin_name}:${hook_type}`) ?? null;
  }

  /** All registrations (observability only). */
  list(): readonly HookRegistrationType[] {
    return [...this.registrations.values()];
  }

  /** Clear (test isolation). */
  reset(): void {
    this.registrations.clear();
  }
}
