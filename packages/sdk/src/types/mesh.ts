/**
 * mesh — Plan58 Mesh SDK schemas (cycle 03-21 Phase 6 第五棒).
 *
 * **Architecture (Plan58 §2 Option B Centralized Hub)**: in-process
 * publisher-subscriber broker; routing-table compiled at boot from plugin
 * manifest declarations; cycle detection via Kahn's topological sort.
 *
 * **Plan52/54/56/57/58 isomorph**: ε-surface delta vs Plan52 baseline =
 * **0 fields, 0 const** (strict equality; MR-6 鐵律).
 *
 * **Forward constraints this cycle (D-§1-R2-E)**:
 *   - Fan-out only (aggregation deferred to Phase 7; DSS-CY21-§1-D preserved)
 *   - In-process single-host (cross-process forward-binding Phase 7)
 *
 * @see openstarry_doc/Technical_Specifications/Plan58_Mesh_Binding.md
 */

import { z } from 'zod';

/** Plan58 §2.3 — routing rule declared in plugin manifest. */
export const MeshRoutingRuleSchema = z.object({
  /** Topic identifier (publisher's category). */
  topic: z.string().min(1),
  /** Target plugins receiving fan-out delivery. */
  target_plugins: z.array(z.string().min(1)).min(1),
});
export type MeshRoutingRule = z.infer<typeof MeshRoutingRuleSchema>;

/** Plan58 mesh message envelope. */
export const MeshMessageSchema = z.object({
  topic: z.string().min(1),
  /** Originating plugin identifier (for fan-out routing). */
  source_plugin: z.string().min(1),
  /** ≥ 16 bytes entropy CSPRNG nonce (Plan52 CV-03). */
  nonce: z.string().regex(/^[A-Fa-f0-9]{32,}$/),
  /** UTC ISO-8601 timestamp at emission. */
  ts_utc: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/),
  /** HMAC-SHA256 over canonical fields (hex). */
  hmac_signature: z.string().regex(/^[A-Fa-f0-9]{64}$/),
  /** Opaque payload (redacted in logs per γ retrofit format). */
  payload: z.unknown(),
});
export type MeshMessage = z.infer<typeof MeshMessageSchema>;

/** Per-emission outcome. */
export const MeshPublishResultSchema = z.object({
  success: z.boolean(),
  /** Number of target plugins routed to (0 on failure). */
  fanout_count: z.number().int().nonnegative(),
  reason: z.enum([
    'invalid_request_schema',
    'tokenSig_verification_failed',
    'nonce_replay',
    'topic_unregistered',
    'cycle_detected_at_boot',
    'plugin_internal_error',
  ]).optional(),
});
export type MeshPublishResult = z.infer<typeof MeshPublishResultSchema>;

/** Replay cache prefix per Plan58 §2.2 (5th contributor). */
export const MESH_REPLAY_CACHE_PREFIX = 'msh:' as const;
