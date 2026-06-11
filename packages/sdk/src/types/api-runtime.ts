/**
 * api-runtime — Plan59 API Runtime SDK schemas (cycle 03-22 Phase 6 第六棒).
 *
 * **Architecture (Plan59 §2 — plugin form upfront)**: Vijnana (識蘊;
 * 「了別」 discriminating awareness) translated to two paths:
 *   - **observe** — read-only introspection (idempotent; no replay cache);
 *   - **invoke** — bounded mutating intervention (HMAC + `apr:` replay cache).
 *
 * **Plan52/54/56/57/58/59 isomorph**: ε-surface delta vs Plan52 baseline =
 * **0 fields, 0 const** (strict equality; MR-6 鐵律). Plugin-internal namespace
 * (`PluginRuntimeStateView` / `HandlerFrame` / `ReplayStats`) lives ENTIRELY
 * inside the api-runtime plugin schema; ε-surface envelope (capability_holdings
 * / parent_agent_id / nonce / signature) does NOT expose any plugin-internal
 * type. `IRuntime.*` method signatures do NOT reference ε-surface envelope
 * fields (boundary invariant verifiable by static-analysis grep per
 * KERNEL R2 sub-check #7 set-disjointness predicate).
 *
 * **Intervention bounded enumeration (4-row tuple; R3 D-§1-Clarif C3 23/0)**:
 *   1. log-level toggle (info|warn|error|debug)
 *   2. debug flag toggle (boolean)
 *   3. soft tracing on/off (boolean)
 *   4. ANY other intervention category requires R-input + R3 vote → reject
 *
 * @see openstarry_doc/Technical_Specifications/Plan59_API_Runtime_Binding.md
 */

import { z } from 'zod';

/** Plan59 §4 — replay cache prefix (6th contributor; per Batch 19 Item #4 R2-C). */
export const API_RUNTIME_REPLAY_CACHE_PREFIX = 'apr:' as const;

/** Plan59 §6.3 — bounded intervention 4-tuple discriminator. */
export const INTERVENTION_KINDS = [
  'log_level',
  'debug_flag',
  'soft_tracing',
] as const;
export type InterventionKind = (typeof INTERVENTION_KINDS)[number];

/** Per-plugin log-level discriminator. */
export const LOG_LEVELS = ['info', 'warn', 'error', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Plan59 §6.3 — intervention payload, discriminated union by `kind`. */
export const InterventionPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('log_level'), level: z.enum(LOG_LEVELS) }),
  z.object({ kind: z.literal('debug_flag'), enabled: z.boolean() }),
  z.object({ kind: z.literal('soft_tracing'), enabled: z.boolean() }),
]);
export type InterventionPayload = z.infer<typeof InterventionPayloadSchema>;

/** Plan59 §6.1 — invoke (mutating) request envelope (HMAC + `apr:` replay). */
export const ApiRuntimeInvokeRequestSchema = z.object({
  /** Plugin identifier whose runtime state to mutate. */
  target_plugin: z.string().min(1),
  /** Bounded intervention payload (4-row tuple; rejects unknown kinds at parse). */
  intervention: InterventionPayloadSchema,
  /**
   * CSPRNG nonce — N=8 hex chars (DSS-CY21-§1-B + DSS-CY22-§1-B KERNEL preferred
   * per MR-11; verbatim cycle 03-21 setting per Plan59 §4 R2-C item #2).
   */
  nonce: z.string().regex(/^[A-Fa-f0-9]{8,}$/),
  /** UTC ISO-8601 emission timestamp. */
  ts_utc: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/),
  /** HMAC-SHA256 hex over canonical signing input. */
  hmac_signature: z.string().regex(/^[A-Fa-f0-9]{64}$/),
});
export type ApiRuntimeInvokeRequest = z.infer<typeof ApiRuntimeInvokeRequestSchema>;

/** Plan59 §6.1 — invoke (mutating) result. */
export const ApiRuntimeInvokeResultSchema = z.object({
  success: z.boolean(),
  reason: z
    .enum([
      'invalid_request_schema',
      'tokenSig_verification_failed',
      'nonce_replay',
      'plugin_unregistered',
      'intervention_kind_out_of_scope',
      'plugin_internal_error',
    ])
    .optional(),
});
export type ApiRuntimeInvokeResult = z.infer<typeof ApiRuntimeInvokeResultSchema>;

/** Plan59 §6.1 — read-only observation scope (filter; no replay). */
export const ApiRuntimeObserveScopeSchema = z.object({
  /** Optional plugin filter; omitted = all registered plugins. */
  target_plugin: z.string().min(1).optional(),
});
export type ApiRuntimeObserveScope = z.infer<typeof ApiRuntimeObserveScopeSchema>;

/** Per-plugin runtime state view (read-only introspection result). */
export const PluginRuntimeStateViewSchema = z.object({
  plugin_id: z.string().min(1),
  log_level: z.enum(LOG_LEVELS),
  debug_flag: z.boolean(),
  soft_tracing: z.boolean(),
  /** Plan59 §6.1 read-only replay cache stats (size only; no nonces leaked). */
  replay_cache_size: z.number().int().nonnegative(),
});
export type PluginRuntimeStateView = z.infer<typeof PluginRuntimeStateViewSchema>;

/** Read-only observation result. */
export const ApiRuntimeObserveResultSchema = z.object({
  plugins: z.array(PluginRuntimeStateViewSchema),
});
export type ApiRuntimeObserveResult = z.infer<typeof ApiRuntimeObserveResultSchema>;
