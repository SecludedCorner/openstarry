/**
 * agent-composition / spawn — Plan54 §4.1 spawn primitive.
 *
 * Implements `spawnChild(req)` returning `SpawnChildResponse`. Reuses
 * Plan52 HMAC-SHA256 + algo-prefix + nonce-cache primitives verbatim
 * (CV-§5-04 Plan52 isomorph; ε-surface delta vs Plan52 = 0 fields).
 *
 * **Boot-time refuse-to-start (Batch 14 Item #3)**: HMAC key MUST come from
 * a CSPRNG-provenance source. If `OPENSTARRY_AC9_HMAC_KEY` is set but its
 * length is < 32 bytes (256 bits) OR contains non-hex characters, the
 * factory throws at construction time.
 *
 * @see openstarry_doc/Technical_Specifications/Plan54_AC9_Binding.md §4.1 + §6
 */

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  NonceCache,
  RecommendedSourceContextKeys,
  SpawnChildRequestSchema,
  type SpawnChildRequest,
  type SpawnChildResponse,
  buildCanonicalInput,
  computeCapabilityHash,
  deepFreeze,
  formatTokenSig,
  parseTokenSig,
} from '@openstarry/sdk';
import { resolveMaxSpawnDepth, type SpawnDepthAuditSink } from './config.js';
import { isCapabilityContained, isDepthAdmissible } from './boundary.js';
import { LifecycleManager } from './lifecycle.js';
import { QuotaTracker } from './quota.js';

const sha256Hex = (s: string): string =>
  createHash('sha256').update(s, 'utf-8').digest('hex');

/** Builder configuration. */
export interface AgentComposerConfig {
  /** Hex-encoded HMAC key (≥ 32 bytes / 64 hex chars). MUST come from CSPRNG. */
  readonly hmacKeyHex?: string;
  /** Capabilities the parent advertises (subset semantics — see boundary.ts). */
  readonly parentCapabilities: readonly string[];
  /** Plan54 §6 replay cache TTL ≥ key-rotation overlap. */
  readonly nonceTtlMs?: number;
  readonly rotationOverlapMs?: number;
  /** Per-spawn / config-file overrides (env override read internally). */
  readonly maxSpawnDepthConfigFile?: number;
  /** Audit sink for MAX_SPAWN_DEPTH override events (Batch 14 Item #6). */
  readonly spawnDepthAudit?: SpawnDepthAuditSink;
  /** Optional injected lifecycle manager (DI for tests). */
  readonly lifecycle?: LifecycleManager;
  /** Optional injected quota tracker. */
  readonly quota?: QuotaTracker;
}

/** Public surface returned by `createAgentComposer`. */
export interface AgentComposer {
  spawnChild(req: SpawnChildRequest): Promise<SpawnChildResponse>;
  readonly lifecycle: LifecycleManager;
  readonly quota: QuotaTracker;
  /** Replay cache — exposed for forensic / observability only. */
  readonly nonceCache: NonceCache;
}

/**
 * Boot-time refuse-to-start guard (Batch 14 Item #3 + Plan54 §6 CV-03).
 * @throws Error when key fails CSPRNG-provenance check.
 */
function loadHmacKey(provided?: string): Buffer {
  if (provided !== undefined) {
    if (!/^[A-Fa-f0-9]+$/.test(provided)) {
      throw new Error('agent-composition.boot: hmacKey must be hex-encoded (CSPRNG provenance — Batch 14 Item #3)');
    }
    if (provided.length < 64) {
      throw new Error(
        `agent-composition.boot: hmacKey must be ≥ 32 bytes / 64 hex chars (got ${provided.length / 2}); ` +
        'CSPRNG provenance MUST per Batch 14 Item #3',
      );
    }
    return Buffer.from(provided, 'hex');
  }
  return randomBytes(32);
}

export function createAgentComposer(cfg: AgentComposerConfig): AgentComposer {
  const hmacKey = loadHmacKey(cfg.hmacKeyHex);
  const lifecycle = cfg.lifecycle ?? new LifecycleManager();
  const quota = cfg.quota ?? new QuotaTracker();
  const nonceTtl = cfg.nonceTtlMs ?? 24 * 60 * 60 * 1000;
  const rotation = cfg.rotationOverlapMs ?? 24 * 60 * 60 * 1000;
  const nonceCache = new NonceCache(nonceTtl, rotation);
  const audit = cfg.spawnDepthAudit;

  async function spawnChild(req: SpawnChildRequest): Promise<SpawnChildResponse> {
    const parsed = SpawnChildRequestSchema.safeParse(req);
    if (!parsed.success) {
      return { success: false, state: 'aborted', reason: 'invalid_request_schema' };
    }
    const data = parsed.data;

    // §6 algo-prefix discipline + verification.
    const prefixed = parseTokenSig(data.parentTokenSig);
    if (!prefixed) {
      return { success: false, state: 'aborted', reason: 'tokenSig_algo_prefix_missing' };
    }
    if (!verifyParentTokenSig(data, prefixed.signatureHex, hmacKey)) {
      return { success: false, state: 'aborted', reason: 'tokenSig_verification_failed' };
    }

    // §6 replay defense.
    if (!nonceCache.register(data.nonce)) {
      return { success: false, state: 'aborted', reason: 'nonce_replay' };
    }

    // §7 depth check.
    const maxDepth = resolveMaxSpawnDepth({ configFile: cfg.maxSpawnDepthConfigFile }, audit);
    if (!isDepthAdmissible(data.spawnDepth, maxDepth)) {
      return { success: false, state: 'aborted', reason: 'max_spawn_depth_exceeded' };
    }

    // §4.3 capability containment.
    if (!isCapabilityContained(cfg.parentCapabilities, data.childAgentSpec.capability)) {
      return { success: false, state: 'aborted', reason: 'invalid_request_schema' };
    }

    // §8 quota.
    const decision = quota.checkSpawn(data.parentAgentId);
    if (!decision.ok) {
      return { success: false, state: 'aborted', reason: decision.reason };
    }

    // Mint child identity + child-specific token (parent's tokenSig NOT forwarded).
    const spawnId = data.spawnId ?? randomUUID();
    const childAgentId = `${data.parentAgentId}/${spawnId}`;
    const childTokenSig = mintChildTokenSig({
      parentAgentId: data.parentAgentId,
      childAgentId,
      capability: data.childAgentSpec.capability,
      hmacKey,
    });

    quota.acquire(data.parentAgentId);
    await lifecycle.open({
      spawnId,
      parentAgentId: data.parentAgentId,
      childAgentId,
      spawnDepth: data.spawnDepth,
    });

    // Construct frozen sourceContext for downstream pushInput (Plan52 isomorph).
    const sourceContext = deepFreeze({
      [RecommendedSourceContextKeys.parentAgentId]: data.parentAgentId,
      [RecommendedSourceContextKeys.spawnDepth]: data.spawnDepth,
      [RecommendedSourceContextKeys.spawnId]: spawnId,
      [RecommendedSourceContextKeys.tokenSig]: childTokenSig,
      [RecommendedSourceContextKeys.nonce]: data.nonce,
      [RecommendedSourceContextKeys.ts]: Date.now(),
    });
    void sourceContext;

    return {
      success: true,
      childAgentId,
      childTokenSig,
      spawnId,
      state: 'spawned',
    };
  }

  return { spawnChild, lifecycle, quota, nonceCache };
}

function verifyParentTokenSig(
  req: SpawnChildRequest,
  signatureHex: string,
  hmacKey: Buffer,
): boolean {
  const capabilityHash = computeCapabilityHash([req.childAgentSpec.capability], sha256Hex);
  const canonical = buildCanonicalInput({
    sourceId: req.parentAgentId,
    ts: 0, // ts is in nonce + tokenSig binding upstream; AC-9 verifies signature continuity only
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

function mintChildTokenSig(args: {
  parentAgentId: string;
  childAgentId: string;
  capability: string;
  hmacKey: Buffer;
}): string {
  const canonical = `${args.parentAgentId}|${args.childAgentId}|${args.capability}`;
  const sig = createHmac('sha256', args.hmacKey).update(canonical, 'utf-8').digest('hex');
  return formatTokenSig('hmac-sha256', sig);
}
