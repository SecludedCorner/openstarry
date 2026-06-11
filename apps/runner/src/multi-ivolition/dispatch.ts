/**
 * multi-ivolition / dispatch — Plan56 D-30-4 main entry.
 *
 * `processVolitions(context)` — per-cognitive-moment processor. Implements:
 *   - Plan56 §2.3 queue-as-stream FIFO drain
 *   - Plan52 isomorph HMAC verify + algo-prefix discipline (§5.1)
 *   - Plan52 nonce-cache replay defense via shared NonceCache (§5.2)
 *   - Plan56 §7.3 per-emission parent quota consumption (R3 A9)
 *   - F-16 SHOULD-initial structured-error reasons on failure
 *   - Volition-payload redaction format (§5.3 R3 A4)
 *
 * **MR-6 posture**: plugin-layer; Core never sees this.
 * **ε-surface**: 0 fields, 0 const vs Plan52 baseline (strict equality).
 *
 * @see research record/cycle03-18/deliver/O1_D30_4_Plan56_implementation_final.md
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  buildCanonicalInput,
  computeCapabilityHash,
  deepFreeze,
  NonceCache,
  parseTokenSig,
  RecommendedSourceContextKeys,
  VolitionEmitResultSchema,
  VolitionRequestSchema,
  type CognitiveMomentContext,
  type VolitionEmitResult,
  type VolitionRequest,
} from '@openstarry/sdk';
import {
  resolveMaxVolitionQueue,
  type VolitionQueueAuditSink,
} from './config.js';
import { VolitionQueue } from './queue.js';
import { redactVolitionPayload } from './redaction.js';

const sha256Hex = (s: string): string =>
  createHash('sha256').update(s, 'utf-8').digest('hex');

/** Configuration for the multi-volition dispatcher. */
export interface MultiIVolitionDispatcherConfig {
  /** Hex-encoded HMAC key (≥ 32 bytes / 64 hex chars). MUST come from CSPRNG. */
  readonly hmacKeyHex?: string;
  /** Capabilities the parent advertises (subset semantics). */
  readonly parentCapabilities: readonly string[];
  /** Nonce TTL ≥ key-rotation overlap (Plan52 CV-06). */
  readonly nonceTtlMs?: number;
  readonly rotationOverlapMs?: number;
  /** Inject the shared NonceCache (replay-cache topology three-contributor §5.2). */
  readonly sharedNonceCache?: NonceCache;
  /** Audit sink for env-override / out-of-range events. */
  readonly queueAudit?: VolitionQueueAuditSink;
  /**
   * Emit hook — caller wires this to Plan52 pushInput pathway. Returns the
   * frozen sourceContext that was emitted (for redacted-log compatibility).
   */
  readonly onEmit?: (sourceContext: Readonly<Record<string, unknown>>) => void;
}

/** Public dispatcher surface returned by `createMultiIVolitionDispatcher`. */
export interface MultiIVolitionDispatcher {
  processVolitions(context: CognitiveMomentContext): VolitionEmitResult[];
  /** Replay cache (exposed for forensic / observability only). */
  readonly nonceCache: NonceCache;
}

/** Boot-time refuse-to-start guard inheriting AC-9 §5.5 four verifications. */
function loadHmacKey(provided?: string): Buffer {
  if (provided !== undefined) {
    if (!/^[A-Fa-f0-9]+$/.test(provided)) {
      throw new Error('multi-ivolition.boot: hmacKey must be hex-encoded (CSPRNG provenance)');
    }
    if (provided.length < 64) {
      throw new Error(
        `multi-ivolition.boot: hmacKey must be ≥ 32 bytes / 64 hex chars (got ${provided.length / 2})`,
      );
    }
    return Buffer.from(provided, 'hex');
  }
  return randomBytes(32);
}

export function createMultiIVolitionDispatcher(
  cfg: MultiIVolitionDispatcherConfig,
): MultiIVolitionDispatcher {
  const hmacKey = loadHmacKey(cfg.hmacKeyHex);
  const nonceTtl = cfg.nonceTtlMs ?? 24 * 60 * 60 * 1000;
  const rotation = cfg.rotationOverlapMs ?? 24 * 60 * 60 * 1000;
  // Replay-cache topology three-contributor (§5.2): when sharedNonceCache is
  // supplied, Plan56 shares with Plan52 + Plan54; otherwise owns its own.
  const nonceCache = cfg.sharedNonceCache ?? new NonceCache(nonceTtl, rotation);

  function processVolitions(context: CognitiveMomentContext): VolitionEmitResult[] {
    const cap = resolveMaxVolitionQueue(cfg.queueAudit);
    const queue = new VolitionQueue(cap);
    const results: VolitionEmitResult[] = [];

    let parentQuotaRemaining = context.parentQuotaRemaining;
    let emitOrder = 0;

    for (const v of context.volitions) {
      // §7.2 NEG-D1: queue cap enforcement.
      if (!queue.enqueue(v)) {
        results.push(buildResult(emitOrder, false, 'volition_queue_cap_exceeded'));
        emitOrder++;
        continue;
      }
    }

    // SICP queue-as-stream drain: pop FIFO, validate, emit.
    for (const v of queue.drain()) {
      const r = emitOne(v, emitOrder, parentQuotaRemaining);
      results.push(r);
      if (r.success) {
        parentQuotaRemaining--;
      }
      emitOrder++;
    }
    return results;

    function emitOne(
      raw: VolitionRequest,
      orderIdx: number,
      quotaRemaining: number,
    ): VolitionEmitResult {
      // Schema validation (Plan56 §2 + Plan52 invariant integrity).
      const parsed = VolitionRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return buildResult(orderIdx, false, 'invalid_request_schema');
      }
      const data = parsed.data;

      // §7.3 NEG-A9: per-emission parent quota consumption.
      if (quotaRemaining <= 0) {
        return buildResult(orderIdx, false, 'parent_quota_exhausted');
      }

      // Algo-prefix discipline (Plan52 CV-04).
      const prefixed = parseTokenSig(data.parentTokenSig);
      if (!prefixed) {
        return buildResult(orderIdx, false, 'tokenSig_algo_prefix_missing');
      }

      // Capability containment check.
      if (!cfg.parentCapabilities.includes(data.category)) {
        return buildResult(orderIdx, false, 'volition_capability_denied');
      }

      // HMAC verify (whole-payload signed atomicity per R3 §3.6 D-§2-R2-F).
      if (!verifyVolitionTokenSig(data, prefixed.signatureHex, hmacKey)) {
        return buildResult(orderIdx, false, 'tokenSig_verification_failed');
      }

      // Replay defense (HMAC nonce keyed per §7.1).
      if (!nonceCache.register(data.nonce)) {
        return buildResult(orderIdx, false, 'nonce_replay');
      }

      // Build frozen sourceContext for Plan52 emit (Plan52 isomorph; CP-4).
      const sourceContext = deepFreeze({
        [RecommendedSourceContextKeys.parentAgentId]: data.parentAgentId,
        [RecommendedSourceContextKeys.tokenSig]: data.parentTokenSig,
        [RecommendedSourceContextKeys.nonce]: data.nonce,
        [RecommendedSourceContextKeys.ts]: Date.now(),
        // Plan52 sourceContext metadata field; Plan56 internal convention only.
        volition_category: data.category,
        volition_emit_order: orderIdx,
        volition_payload_redacted: redactVolitionPayload(data.payload),
        volition_priority: data.priority,
      });

      cfg.onEmit?.(sourceContext);

      return buildResult(orderIdx, true);
    }
  }

  return { processVolitions, nonceCache };
}

function verifyVolitionTokenSig(
  req: VolitionRequest,
  signatureHex: string,
  hmacKey: Buffer,
): boolean {
  const capabilityHash = computeCapabilityHash([req.category], sha256Hex);
  const canonical = buildCanonicalInput({
    sourceId: req.parentAgentId,
    ts: 0,
    nonce: req.nonce,
    capabilityHash,
  });
  const expected = createHmac('sha256', hmacKey).update(canonical, 'utf-8').digest();
  let received: Buffer;
  try {
    received = Buffer.from(signatureHex, 'hex');
  } catch {
    return false;
  }
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

function buildResult(
  emit_order: number,
  success: boolean,
  reason?: VolitionEmitResult['reason'],
): VolitionEmitResult {
  const result = success
    ? { success, emit_order }
    : { success, emit_order, reason };
  return VolitionEmitResultSchema.parse(result);
}
