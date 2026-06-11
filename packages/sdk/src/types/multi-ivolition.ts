/**
 * multi-ivolition — Plan56 D-30-4 Multi-IVolition SDK schemas (cycle 03-18).
 *
 * **Plan52/Plan54 isomorph (CV-§5-04)**: Multi-IVolition reuses Plan52
 * sourceContext + tokenSig discipline verbatim. ε-surface delta vs Plan52
 * baseline = **0 fields, 0 const** (strict equality; MR-6 鐵律).
 *
 * **Architecture (Plan56 §2 Option A)**: single-stream multi-volition queue
 * (SICP queue-as-stream); per-cognitive-moment FIFO drain; no central
 * registry; no arbitration substrate; compositional closure.
 *
 * **MR-6 posture**: types live in SDK (not Core); Core never imports.
 *
 * @see research record/cycle03-18/deliver/O1_D30_4_Plan56_implementation_final.md
 */

import { z } from 'zod';

/** Closed enum of Plan56 volition categories per spec §5.4. */
export const VOLITION_CATEGORIES = ['retrieve', 'verify', 'track-context', 'surface-failure'] as const;
export type VolitionCategory = (typeof VOLITION_CATEGORIES)[number];
export const VolitionCategorySchema = z.enum(VOLITION_CATEGORIES);

/**
 * Plan56 §X Volition request — per-volition payload within a cognitive moment.
 * Plugin-internal; NOT a new InputEvent shape (Plan52 invariant #3).
 */
export const VolitionRequestSchema = z.object({
  /** Volition category (typed payload sensitivity profile per §5.4). */
  category: VolitionCategorySchema,
  /** Plan52 isomorph: parent agent identity. */
  parentAgentId: z.string().min(1),
  /** Plan52 algo-prefix tokenSig (`<algo>:<value>`). */
  parentTokenSig: z.string().regex(/^[a-z0-9-]+:[A-Fa-f0-9]+$/, {
    message: 'tokenSig must follow `<algo>:<value>` algo-prefix discipline (Plan52 isomorph)',
  }),
  /** Volition body — opaque to Core; redacted in logs per §5.3. */
  payload: z.string(),
  /** Plan52 priority/intensity weight (0..1; non-binding internal hint). */
  priority: z.number().min(0).max(1).default(0.5),
  /** ≥ 16 bytes entropy CSPRNG nonce (Plan52 CV-03 inheritance). */
  nonce: z.string().regex(/^[A-Fa-f0-9]{32,}$/, {
    message: 'nonce must be ≥ 16 bytes (32+ hex chars) per CV-03 CSPRNG provenance',
  }),
});
export type VolitionRequest = z.infer<typeof VolitionRequestSchema>;

/** Per-emission outcome enum (extends AC-9 failure taxonomy with Plan56 cases). */
export const VolitionEmitResultSchema = z.object({
  success: z.boolean(),
  /** Volition emit order within the cognitive moment (0-indexed). */
  emit_order: z.number().int().nonnegative(),
  /** Outcome reason taxonomy per Plan56 §7 + AC-9 inheritance. */
  reason: z.enum([
    'invalid_request_schema',
    'tokenSig_algo_prefix_missing',
    'tokenSig_verification_failed',
    'nonce_replay',
    'volition_queue_cap_exceeded',
    'volition_queue_out_of_range',
    'parent_quota_exhausted',
    'volition_capability_denied',
    'plugin_internal_error',
  ]).optional(),
});
export type VolitionEmitResult = z.infer<typeof VolitionEmitResultSchema>;

/** Plan56 §7.3 cognitive-moment context — per-moment quota carrier. */
export interface CognitiveMomentContext {
  readonly momentId: string;
  readonly parentAgentId: string;
  /**
   * Per-moment parent quota cap (per Plan54 §8 inheritance + cycle 03-18
   * R3 A9 23/0); each emission consumes 1 unit.
   */
  readonly parentQuotaRemaining: number;
  /** Volitions queued for this moment. */
  readonly volitions: readonly VolitionRequest[];
}
