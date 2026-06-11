/**
 * zod-gate / checkpoint-schemas — Plan51 Module 2 (rollout #2).
 *
 * Versioned `CheckpointSchema<V>` family + cross-version-skew migration matrix
 * MUST per D-§5-G UNANIMOUS 23/0. Covers v0.42 → v0.45 → v0.48 → v0.50 (≥3
 * prior versions).
 *
 * **Read-path discipline (graceful degradation)**: never block recovery on
 * Zod gate failure. Audited mode default; emits distinguishable
 * `checkpoint_schema_violation` vs `checkpoint_migration_applied` events.
 *
 * **Write-path discipline**: assertion-style — writer always knows the current
 * schema; LOW migration risk.
 *
 * **MR-12 honoured iff helpers present** — without these, Plan51 read-path
 * Zod enforcement breaks pre-Plan51 checkpoints. R3 D-§5-G ratified MUST level
 * precisely to close this.
 *
 * @see openstarry_doc/Technical_Specifications/Plan51_Zod_Gate_Binding.md §4.2 + §5
 */

import { z } from 'zod';
import { validateInbound, assertOutbound } from './middleware.js';

/** Supported checkpoint schema versions. Forward-only enumeration. */
export const CHECKPOINT_SCHEMA_VERSIONS = ['v0.42', 'v0.45', 'v0.48', 'v0.50'] as const;
export type CheckpointSchemaVersion = (typeof CHECKPOINT_SCHEMA_VERSIONS)[number];

/** v0.50 — current. Newest baseline; all writes go here. */
const CheckpointV050 = z.object({
  schema_version: z.literal('v0.50'),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  created_at: z.number().int().nonnegative(),
  state: z.unknown(),
  hmac_envelope: z.object({
    algorithm: z.literal('sha256'),
    nonce: z.string().regex(/^[0-9a-fA-F]+$/),
    signature: z.string().regex(/^[0-9a-fA-F]+$/),
    signed_at: z.number().int().nonnegative(),
  }).optional(),
});

const CheckpointV048 = CheckpointV050
  .omit({ schema_version: true })
  .extend({ schema_version: z.literal('v0.48') });

const CheckpointV045 = z.object({
  schema_version: z.literal('v0.45'),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  created_at: z.number().int().nonnegative(),
  state: z.unknown(),
});

const CheckpointV042 = z.object({
  schema_version: z.literal('v0.42'),
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  state: z.unknown(),
});

/** Discriminated union over all supported versions. */
export const CheckpointSchema = z.discriminatedUnion('schema_version', [
  CheckpointV042,
  CheckpointV045,
  CheckpointV048,
  CheckpointV050,
]);

export type CheckpointV050Type = z.infer<typeof CheckpointV050>;

/** Audit event types per spec §5.3 sub-item 5. */
export type CheckpointAuditEvent =
  | { event: 'checkpoint_schema_violation'; from_version: string | null; reason: string }
  | { event: 'checkpoint_migration_applied'; from_version: CheckpointSchemaVersion; to_version: 'v0.50' };

/** Caller wires this to Plan48 structured-log if desired; no-op default. */
export type CheckpointAuditSink = (event: CheckpointAuditEvent) => void;
const NOOP_AUDIT: CheckpointAuditSink = () => {};

/**
 * Migrate any supported version to the v0.50 canonical shape.
 *
 * Per-version migration matrix (D-§5-G §5.3 sub-item 4):
 *   v0.42 → camelCase rename (agentId → agent_id, etc.) → v0.45 shape
 *   v0.45 → identity → v0.45 shape
 *   v0.48 → drop hmac_envelope optional differences → v0.50 shape (additive)
 *   v0.50 → identity
 */
function migrateToV050(parsed: z.infer<typeof CheckpointSchema>): CheckpointV050Type {
  switch (parsed.schema_version) {
    case 'v0.42':
      return {
        schema_version: 'v0.50',
        agent_id: parsed.agentId,
        session_id: parsed.sessionId,
        created_at: parsed.createdAt,
        state: parsed.state,
      };
    case 'v0.45':
      return {
        schema_version: 'v0.50',
        agent_id: parsed.agent_id,
        session_id: parsed.session_id,
        created_at: parsed.created_at,
        state: parsed.state,
      };
    case 'v0.48':
      return { ...parsed, schema_version: 'v0.50' };
    case 'v0.50':
      return parsed;
  }
}

/**
 * Read-path entry point: parse inbound checkpoint with graceful degradation.
 *
 * Per §4.2 + §5.3 sub-items 2 + 3: audited-mode default; never block recovery.
 * On parse failure returns `null` AND emits `checkpoint_schema_violation`
 * audit event; caller falls back to fresh state per existing `tool-filter-proxy`
 * pattern (apps/runner/src/utils).
 *
 * On parse success and version != v0.50, applies migration and emits
 * `checkpoint_migration_applied`.
 */
export function readCheckpoint(
  raw: unknown,
  audit: CheckpointAuditSink = NOOP_AUDIT,
): CheckpointV050Type | null {
  const result = validateInbound(CheckpointSchema, raw, 'checkpoint-store.read');
  if (!result.ok) {
    audit({ event: 'checkpoint_schema_violation', from_version: null, reason: result.error });
    return null;
  }
  const fromVersion = result.data.schema_version;
  const migrated = migrateToV050(result.data);
  if (fromVersion !== 'v0.50') {
    audit({ event: 'checkpoint_migration_applied', from_version: fromVersion, to_version: 'v0.50' });
  }
  return migrated;
}

/** Write-path: assertion-style on the v0.50 baseline (we control the producer). */
export function writeCheckpoint(value: CheckpointV050Type): CheckpointV050Type {
  return assertOutbound(CheckpointV050, value, 'checkpoint-store.write');
}
