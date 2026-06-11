/**
 * pushinput-helpers — Plan52 Candidate B SDK helpers for transport plugins
 * implementing pushInput source authentication.
 *
 * **MR-6 posture**: this module lives under `packages/sdk/`, NOT `packages/core/`.
 * Core gains ZERO knowledge of these helpers; they are SHOULD-follow conventions
 * for transport plugins (Tenet #2 plugin-delegation).
 *
 * **CP-1 invariant**: Core never reads `sourceContext.*`; helpers here are for
 * plugin authors to construct + freeze + verify; Core's only role is opaque
 * passthrough of the field.
 *
 * @see openstarry_doc/Technical_Specifications/Plan52_pushInput_Binding.md
 * @see packages/sdk/src/types/events.ts (InputEvent.sourceContext field)
 */

/**
 * RecommendedSourceContextKeys — CR-SCK SDK convention for plugin authors.
 *
 * SHOULD-follow / document-deviation discipline. NOT enforced by Core; Core
 * never reads these keys. Plugins constructing `InputEvent.sourceContext`
 * SHOULD use these names where the semantic matches; deviations MUST be
 * documented in the plugin's manifest or README.
 *
 * Per cycle 03-12 D-26b ratified + cycle 03-14 R3 binding (Plan52 §4.4).
 */
export const RecommendedSourceContextKeys = {
  /** Parent agent identifier for multi-agent routing (Plan54 AC-9 attested). */
  parentAgentId: 'parentAgentId',
  /** Capability set (sorted) used in canonicalInput for HMAC binding. */
  capabilitySet: 'capabilitySet',
  /** mTLS certificate / public-key material (transport-http typical). */
  cert: 'cert',
  /** HMAC-SHA256 or Ed25519 token signature, prefix-discipline applied. */
  tokenSig: 'tokenSig',
  /** Random nonce for replay defense (hex-encoded). */
  nonce: 'nonce',
  /** Unix epoch ms timestamp at signing; freshness check. */
  ts: 'ts',
  /** Optional trust score (0..1) for L2/L3 escalation hints. */
  trust_score: 'trust_score',
  /** Plan54 AC-9 — sub-agent recursion depth (root = 0). Forward-only MR-12 ext. */
  spawnDepth: 'spawnDepth',
  /** Plan54 AC-9 — unique spawn identifier (UUID); plugin generates if absent. */
  spawnId: 'spawnId',
} as const;

/** Type-level enumeration of recommended sourceContext keys. */
export type RecommendedSourceContextKey =
  (typeof RecommendedSourceContextKeys)[keyof typeof RecommendedSourceContextKeys];

/**
 * deepFreeze — recursive Object.freeze across plain objects and arrays.
 *
 * Plan52 R3 D-§1-05 (21/2/0) BINDING — applied at plugin emit boundary BEFORE
 * the `sourceContext` field is forwarded to Core. Enforces CP-4: once attested
 * by the plugin, the context is immutable downstream.
 *
 * **Performance** (DSS-14 absorbed): typical sourceContext shapes are < 10 keys
 * and < 3 levels deep; recursive cost is negligible per call. If Plan52
 * profiling surfaces hot-path cost, fall-back is shallow-freeze + downstream
 * defensive-copy (documented amendment route).
 *
 * Returns the same reference (mutated in place) for fluent composition.
 */
export function deepFreeze<T>(value: T): Readonly<T> {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value as Readonly<T>;

  const obj = value as unknown as Record<string | number | symbol, unknown>;
  for (const key of Reflect.ownKeys(obj)) {
    const child = obj[key as string];
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return Object.freeze(value);
}

/**
 * Key material returned by a `KeyResolver` lookup.
 *
 * Per Plan52 MRB-§1-04 RESOLVED — algorithm is part of the resolved tuple so
 * algorithm migration becomes a key-rotation event (not a code-path change).
 */
export interface ResolvedKey {
  /** Stable key identifier; rotation produces a new `kid`. */
  readonly kid: string;
  /** Raw key material; HMAC: ≥ 32 bytes. Ed25519: 32-byte private/public. */
  readonly key: Buffer;
  /** Algorithm advertised for this key. */
  readonly algorithm: 'hmac-sha256' | 'ed25519';
}

/**
 * KeyResolver — plugin-side abstraction for resolving signing/verifying keys
 * by `kid`. Plan52 plugins construct one and inject into transport-side
 * verifier setup; SDK provides no default impl (Tenet #2 plugin-delegation).
 */
export interface KeyResolver {
  /** Resolve key material for a given `kid`; return null if unknown/expired. */
  resolve(kid: string): ResolvedKey | null | Promise<ResolvedKey | null>;
}

/**
 * NonceCache — in-memory replay-defense cache with TTL eviction.
 *
 * Plan52 R3 D-§1-06 UNANIMOUS — TTL MUST be ≥ key-rotation overlap window.
 * Default TTL = 15 min; default rotation overlap = 10 min; margin = 5 min.
 *
 * **Single-process**: bound to plugin process lifetime; cross-process
 * deployments need a shared store (Redis / etc.) — out of SDK scope.
 *
 * **MUST be configured**: constructor enforces ttlMs ≥ rotationOverlapMs.
 */
export class NonceCache {
  private readonly seen = new Map<string, number>(); // nonce -> expiresAt epoch ms

  constructor(
    private readonly ttlMs: number,
    private readonly rotationOverlapMs: number,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error(`NonceCache: ttlMs must be positive, got ${ttlMs}`);
    }
    if (!Number.isFinite(rotationOverlapMs) || rotationOverlapMs <= 0) {
      throw new Error(`NonceCache: rotationOverlapMs must be positive, got ${rotationOverlapMs}`);
    }
    if (ttlMs < rotationOverlapMs) {
      throw new Error(
        `NonceCache: ttlMs (${ttlMs}) must be >= rotationOverlapMs (${rotationOverlapMs}) — ` +
        `Plan52 D-§1-06 invariant; stale-nonce-acceptance during key rotation otherwise possible`,
      );
    }
  }

  /**
   * Try to register a nonce. Returns true on success, false on replay
   * (nonce already observed within TTL). Side-effect: evicts expired entries.
   */
  register(nonce: string, now: number = Date.now()): boolean {
    this.evictExpired(now);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, now + this.ttlMs);
    return true;
  }

  /** Evict entries whose expiresAt is in the past. O(n) sweep. */
  evictExpired(now: number = Date.now()): void {
    for (const [nonce, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(nonce);
    }
  }

  /** Current size (unevicted). Observability only. */
  get size(): number {
    return this.seen.size;
  }

  /** Clear all observed nonces. Useful for test isolation. */
  reset(): void {
    this.seen.clear();
  }
}

/**
 * Compute capability hash for canonical signing input.
 *
 * Per Plan52 §3.2 + KNUTH R2 amendment §2.2:
 *   capabilityHash = sha256_hex(JSON.stringify(capabilitySet.sort()))
 *
 * Sorting ensures order-stability across plugin authors. Returns hex digest.
 * Caller passes the result into {@link buildCanonicalInput}.
 */
export function computeCapabilityHash(
  capabilitySet: readonly string[],
  hashFn: (input: string) => string,
): string {
  const sorted = [...capabilitySet].sort();
  return hashFn(JSON.stringify(sorted));
}

/**
 * Build the canonical signing input for HMAC-SHA256 / Ed25519 verification.
 *
 * Per Plan52 §3.2:
 *   canonicalInput = sourceId | ts | nonce | capabilityHash
 *
 * Pipe-separated to keep parsing trivial and tamper-resistant. Plugins MUST
 * use this exact format on both sign and verify to interop.
 */
export function buildCanonicalInput(args: {
  readonly sourceId: string;
  readonly ts: number;
  readonly nonce: string;
  readonly capabilityHash: string;
}): string {
  return `${args.sourceId}|${args.ts}|${args.nonce}|${args.capabilityHash}`;
}

/**
 * Format a `tokenSig` string with the required algorithm prefix.
 *
 * Per Plan52 §3.2: verifier MUST refuse if prefix doesn't match resolver's
 * algorithm. Format: `<algorithm>:<signature-hex>`.
 */
export function formatTokenSig(
  algorithm: 'hmac-sha256' | 'ed25519',
  signatureHex: string,
): string {
  return `${algorithm}:${signatureHex}`;
}

/**
 * Parse a `tokenSig` string into its algorithm prefix and signature.
 * Returns null on malformed input (no prefix, unknown algorithm, etc.).
 */
export function parseTokenSig(
  tokenSig: string,
): { algorithm: 'hmac-sha256' | 'ed25519'; signatureHex: string } | null {
  const idx = tokenSig.indexOf(':');
  if (idx <= 0) return null;
  const prefix = tokenSig.slice(0, idx);
  const sig = tokenSig.slice(idx + 1);
  if (prefix !== 'hmac-sha256' && prefix !== 'ed25519') return null;
  if (sig.length === 0) return null;
  return { algorithm: prefix, signatureHex: sig };
}
