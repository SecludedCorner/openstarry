/**
 * vasana-engine — Plan57 D-30-5 VasanaEngine SDK schemas (cycle 03-19).
 *
 * **vasanā** (習氣 / seed-impressions / bīja deposited in 阿賴耶識): passive
 * deposit log of past karma-actions. Plan57 implements Track 1 (deposit-only)
 * per Option C dual-track architecture; Track 2 read-API DEFERRED to Plan60
 * Blackboard-Alaya.
 *
 * **Plan52/54/56 isomorph**: ε-surface delta vs Plan52 baseline = **0 fields,
 * 0 const** (strict equality; MR-6 鐵律). Deposits flow through Plan52
 * sourceContext metadata path.
 *
 * **MR-6 posture**: types live in SDK (not Core); Core never imports.
 *
 * @see openstarry_doc/Technical_Specifications/Plan57_D30_5_VasanaEngine_Binding.md
 */

import { z } from 'zod';

/** Closed enum of vasanā category sensitivity profiles per Plan57 §6. */
export const VASANA_CATEGORIES = ['intent', 'preference', 'aversion', 'action-trace', 'observation', 'timestamp', 'source-ref'] as const;
export type VasanaCategory = (typeof VASANA_CATEGORIES)[number];
export const VasanaCategorySchema = z.enum(VASANA_CATEGORIES);

/** Sensitivity tier for category-aware redaction (HIGH/MED/LOW). */
export type VasanaSensitivity = 'HIGH' | 'MED' | 'LOW';

/** Map of category → sensitivity per Plan57 §6 category-aware redaction. */
export const VASANA_SENSITIVITY: Readonly<Record<VasanaCategory, VasanaSensitivity>> = Object.freeze({
  intent: 'HIGH',
  preference: 'HIGH',
  aversion: 'HIGH',
  'action-trace': 'MED',
  observation: 'MED',
  timestamp: 'LOW',
  'source-ref': 'LOW',
});

/**
 * Plan57 §2.2 deposit entry schema — append-only HMAC-chained.
 *
 * Each entry's `prev_hash` = SHA-256 of the prior entry (or `0x0..0` for the
 * genesis entry). HMAC-chain integrity provides equivalent tamper-evidence
 * to POSIX `O_APPEND` (Plan57 §7 Windows fallback compensating control).
 */
export const VasanaDepositEntrySchema = z.object({
  /** Originating volition (Plan56 link). */
  volition_id: z.string().min(1),
  /** Vasanā category (sensitivity profile per §6). */
  category: VasanaCategorySchema,
  /** UTC ISO-8601 timestamp at deposit time. */
  deposit_time_utc: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/),
  /** Redacted content per §6 codified format `<redacted-vasana-deposit ...>`. */
  content_redacted: z.string().regex(/^<redacted-vasana-deposit len:\d+ first4:[A-Za-z0-9]{0,4}>$/),
  /** HMAC-SHA256 signature over canonical entry fields (hex). */
  hmac_signature: z.string().regex(/^[A-Fa-f0-9]{64}$/),
  /** ≥ 16 bytes entropy CSPRNG nonce (Plan52 CV-03). */
  nonce: z.string().regex(/^[A-Fa-f0-9]{32,}$/),
  /** SHA-256 of prior entry, or 64 zero hex chars for genesis. */
  prev_hash: z.string().regex(/^[A-Fa-f0-9]{64}$/),
  /** This entry's hash (SHA-256 of canonical fields). */
  entry_hash: z.string().regex(/^[A-Fa-f0-9]{64}$/),
});
export type VasanaDepositEntry = z.infer<typeof VasanaDepositEntrySchema>;

/** Plan57 §2.3 deposit request — minimal SICP-canonical surface. */
export const VasanaDepositRequestSchema = z.object({
  volition_id: z.string().min(1),
  category: VasanaCategorySchema,
  /** Raw content (will be redacted before storage). */
  content: z.string(),
  /** Originating parent agent identity (Plan52 isomorph). */
  parentAgentId: z.string().min(1),
  /** ≥ 16 bytes entropy CSPRNG nonce. */
  nonce: z.string().regex(/^[A-Fa-f0-9]{32,}$/),
});
export type VasanaDepositRequest = z.infer<typeof VasanaDepositRequestSchema>;

/** Outcome of `deposit()` — entry hash on success; reason on failure. */
export const VasanaDepositResultSchema = z.object({
  success: z.boolean(),
  entry_hash: z.string().regex(/^[A-Fa-f0-9]{64}$/).optional(),
  entry_index: z.number().int().nonnegative().optional(),
  reason: z.enum([
    'invalid_request_schema',
    'nonce_replay',
    'chain_corruption_detected',
    'plugin_internal_error',
  ]).optional(),
});
export type VasanaDepositResult = z.infer<typeof VasanaDepositResultSchema>;

/** Genesis prev_hash sentinel (64 zero hex chars). */
export const VASANA_GENESIS_PREV_HASH = '0'.repeat(64);

/** Replay cache prefix per Plan57 §5 (4-contributor structured prefix table). */
export const VASANA_REPLAY_CACHE_PREFIX = 'vsn:' as const;
