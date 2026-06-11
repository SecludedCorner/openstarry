/**
 * agent-composition — Plan54 AC-9 Sub-Agent Composition SDK schemas.
 *
 * **Plan52 isomorph (CV-§5-04)**: AC-9 reuses Plan52 sourceContext + tokenSig
 * discipline verbatim. ε-surface delta vs Plan52 baseline = **0 fields, 0
 * const** (strict equality; MR-6 鐵律).
 *
 * **MR-6 posture**: types live in SDK (not Core); Core never imports.
 *
 * **F-15 v3 reflexive scope**: this module's prefix discipline =
 * `verified | inferred | speculative` per Rule #78 §78.4.
 *
 * @see openstarry_doc/Technical_Specifications/Plan54_AC9_Binding.md
 * @see packages/sdk/src/utils/pushinput-helpers.ts (Plan52 isomorph baseline)
 */

import { z } from 'zod';

/**
 * Lifecycle states (Plan54 §4.2 plugin string literals; NOT Core enum).
 *
 * State machine: `spawned → active → {completed, aborted, orphaned}`.
 *
 * NAGARJUNA Madhyamaka annotation (D-18 ADOPT non-binding doc-only): these
 * are conventional truth (saṃvṛti-satya), useful-fictions enabling plugin
 * coordination — NOT metaphysical claims about agents.
 */
export const LIFECYCLE_STATES = ['spawned', 'active', 'completed', 'aborted', 'orphaned'] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];
export const LifecycleStateSchema = z.enum(LIFECYCLE_STATES);

/** Lifecycle hook event names — dispatched via Plan51 hook-registry. */
export const LIFECYCLE_HOOK_EVENTS = ['onSpawned', 'onActive', 'onCompleted', 'onAborted', 'onOrphaned'] as const;
export type LifecycleHookEvent = (typeof LIFECYCLE_HOOK_EVENTS)[number];

/** Plan54 §4.1 SpawnChildRequest — Zod-validated at plugin boundary. */
export const SpawnChildRequestSchema = z.object({
  /** Parent agent identity; signed-token-attested per Plan52 §3.4. */
  parentAgentId: z.string().min(1),
  /**
   * Algo-prefix mandatory (CV-04): `<algo>:<value>` per Plan52 isomorph
   * shipping format (transport-http/-websocket already emit this 2-component
   * shape). Plan54 spec §6 mentions an optional encoding sub-field; encoding
   * is implicit-hex per Plan52 baseline.
   */
  parentTokenSig: z.string().regex(/^[a-z0-9-]+:[A-Fa-f0-9]+$/, {
    message: 'tokenSig must follow `<algo>:<value>` algo-prefix discipline (Plan52 isomorph)',
  }),
  /** Capability + config opaque to Core (CP-1 Plan52 inheritance). */
  childAgentSpec: z.object({
    capability: z.string().min(1),
    config: z.record(z.unknown()),
  }),
  /** Child depth = parent + 1; plugin enforces ≤ MAX_SPAWN_DEPTH. */
  spawnDepth: z.number().int().nonnegative(),
  /** UUID; plugin generates if omitted. */
  spawnId: z.string().min(1).optional(),
  /** ≥ 16 bytes entropy from CSPRNG per CV-03; hex-encoded ≥ 32 chars. */
  nonce: z.string().regex(/^[A-Fa-f0-9]{32,}$/, {
    message: 'nonce must be ≥ 16 bytes (32+ hex chars) per CV-03 CSPRNG provenance',
  }),
});
export type SpawnChildRequest = z.infer<typeof SpawnChildRequestSchema>;

/** Plan54 §4.1 SpawnChildResponse. */
export const SpawnChildResponseSchema = z.object({
  success: z.boolean(),
  childAgentId: z.string().optional(),
  childTokenSig: z.string().optional(),
  spawnId: z.string().optional(),
  state: LifecycleStateSchema,
  /** Failure taxonomy (Plan54 §7.4 + §8 + §6 prefix-missing). */
  reason: z.enum([
    'max_spawn_depth_exceeded',
    'spawn_capacity_exhausted',
    'parent_quota_exhausted',
    'global_quota_exhausted',
    'tokenSig_algo_prefix_missing',
    'tokenSig_verification_failed',
    'nonce_replay',
    'invalid_request_schema',
    'plugin_internal_error',
  ]).optional(),
});
export type SpawnChildResponse = z.infer<typeof SpawnChildResponseSchema>;

/** Plan54 §4.2 lifecycle handler signature (async-friendly). */
export interface LifecycleEvent {
  readonly state: LifecycleState;
  readonly spawnId: string;
  readonly parentAgentId: string;
  readonly childAgentId: string;
  readonly spawnDepth: number;
  readonly timestamp: number;
}
export type LifecycleHandler = (event: LifecycleEvent) => void | Promise<void>;
