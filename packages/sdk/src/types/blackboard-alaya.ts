/**
 * blackboard-alaya — Plan60 Blackboard-Alaya SDK schemas (cycle 03-23 Phase 6
 * 第七棒; **7/7 完工** ✅).
 *
 * **Architecture (Plan60 §2 Option A reuse)**: implementation locus is the
 * existing `@openstarry-plugin/distributed-alaya/` (per D-§1-Clarif C2 23/0
 * naming reconciliation; spec name "Plan60 Blackboard-Alaya" aligns with
 * Phase 6 strict 7-list anchor while plugin filename remains
 * "distributed-alaya"). Forward addendum per MR-12 既有不破壞: existing
 * BijaStore + seed-signature + vector clock + SEC-002 + late-joiner
 * snapshot remain UNCHANGED.
 *
 * **Plan52~Plan60 isomorph (Plan60 §3 11-dimension)**: ε-surface delta vs
 * Plan52 baseline = **0 fields, 0 const** (strict equality; MR-6 鐵律).
 * Plugin-internal namespace (`SeedStore` / `BlackboardKey` / `VectorClock`)
 * does not leak through these schemas.
 *
 * **五蘊 對應**: 識蘊 第八識 (阿賴耶識; ālaya; 一切種子 / 記憶 / 習氣 / 業報
 * storage layer).
 *
 * @see openstarry_doc/Technical_Specifications/Plan60_Blackboard_Alaya_Binding.md
 */

import { z } from 'zod';

/**
 * Plan60 §4 — replay cache prefix (7th contributor; final N=7 topology
 * post-cycle-03-23 per Phase 6 完工; D-§1-B 23/0 UNANIMOUS).
 *
 * `aly:` per ASANGA Sanskrit ālaya transliteration; 3-char-lowercase +
 * colon-suffix; KNUTH algorithm rigor + GUARDIAN prefix-collision Hamming
 * distance ≥ 2 vs the 6 existing prefixes (psh:/ac9:/mvq:/vsn:/msh:/apr:).
 */
export const ALAYA_REPLAY_CACHE_PREFIX = 'aly:' as const;

/** Plan60 §5 — seed deposit attestation request envelope. */
export const AlayaSeedDepositRequestSchema = z.object({
  /** Seed identifier (existing distributed-alaya semantic). */
  seed_id: z.string().min(1),
  /** Hex SHA-256 hash of the canonical seed payload (avoids leaking content). */
  payload_hash: z.string().regex(/^[A-Fa-f0-9]{64}$/),
  /**
   * CSPRNG nonce — N≥8 hex (DSS-CY21-§1-B + DSS-CY22-§1-B + DSS-CY23 KERNEL
   * preferred per MR-11; verbatim cycle 03-21 setting per Plan60 §4 R2-C
   * item #2).
   */
  nonce: z.string().regex(/^[A-Fa-f0-9]{8,}$/),
  /** UTC ISO-8601 emission timestamp. */
  ts_utc: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/),
  /** HMAC-SHA256 hex over canonical signing input. */
  hmac_signature: z.string().regex(/^[A-Fa-f0-9]{64}$/),
});
export type AlayaSeedDepositRequest = z.infer<typeof AlayaSeedDepositRequestSchema>;

/** Seed deposit attestation result. */
export const AlayaSeedDepositResultSchema = z.object({
  success: z.boolean(),
  reason: z
    .enum([
      'invalid_request_schema',
      'tokenSig_verification_failed',
      'nonce_replay',
      'payload_size_exceeded',
      'attestor_internal_error',
    ])
    .optional(),
});
export type AlayaSeedDepositResult = z.infer<typeof AlayaSeedDepositResultSchema>;
