/**
 * pushinput-helpers tests — Plan52 SDK helper unit coverage.
 * Covers Plan52 dev-spec U-1, U-2, U-3, U-6, U-7 outline (Plan52 §4.1).
 */

import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  RecommendedSourceContextKeys,
  deepFreeze,
  NonceCache,
  computeCapabilityHash,
  buildCanonicalInput,
  formatTokenSig,
  parseTokenSig,
} from '../pushinput-helpers.js';

const sha256Hex = (input: string): string =>
  createHash('sha256').update(input, 'utf-8').digest('hex');

describe('Plan52 RecommendedSourceContextKeys', () => {
  it('exposes the 7 SHOULD-follow key names', () => {
    expect(RecommendedSourceContextKeys.parentAgentId).toBe('parentAgentId');
    expect(RecommendedSourceContextKeys.capabilitySet).toBe('capabilitySet');
    expect(RecommendedSourceContextKeys.cert).toBe('cert');
    expect(RecommendedSourceContextKeys.tokenSig).toBe('tokenSig');
    expect(RecommendedSourceContextKeys.nonce).toBe('nonce');
    expect(RecommendedSourceContextKeys.ts).toBe('ts');
    expect(RecommendedSourceContextKeys.trust_score).toBe('trust_score');
  });
});

describe('Plan52 deepFreeze', () => {
  it('freezes the top-level object', () => {
    const frozen = deepFreeze({ a: 1, b: 'two' });
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it('freezes nested object graphs recursively', () => {
    const ctx = { outer: { inner: { leaf: 1 } }, arr: [{ x: 1 }, { y: 2 }] };
    deepFreeze(ctx);
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.outer)).toBe(true);
    expect(Object.isFrozen(ctx.outer.inner)).toBe(true);
    expect(Object.isFrozen(ctx.arr)).toBe(true);
    expect(Object.isFrozen(ctx.arr[0])).toBe(true);
    expect(Object.isFrozen(ctx.arr[1])).toBe(true);
  });

  it('blocks mutation in strict mode (NEG-5 deep mutation)', () => {
    const ctx: { outer: { inner: number } } = { outer: { inner: 1 } };
    deepFreeze(ctx);
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ctx.outer as any).inner = 999;
    }).toThrow();
  });

  it('returns primitives unchanged', () => {
    expect(deepFreeze(42)).toBe(42);
    expect(deepFreeze('hello')).toBe('hello');
    expect(deepFreeze(null)).toBe(null);
  });

  it('is idempotent on already-frozen objects', () => {
    const obj = Object.freeze({ a: 1 });
    expect(() => deepFreeze(obj)).not.toThrow();
  });
});

describe('Plan52 NonceCache', () => {
  it('rejects ttlMs < rotationOverlapMs (D-§1-06 invariant)', () => {
    expect(() => new NonceCache(60_000, 120_000)).toThrow(/ttlMs.*rotationOverlapMs/);
  });

  it('rejects non-positive ttlMs / rotationOverlapMs', () => {
    expect(() => new NonceCache(0, 1)).toThrow(/ttlMs/);
    expect(() => new NonceCache(1000, 0)).toThrow(/rotationOverlapMs/);
  });

  it('first registration succeeds, replay rejected (NEG-2 replay)', () => {
    const cache = new NonceCache(15 * 60_000, 10 * 60_000);
    expect(cache.register('abc', 1000)).toBe(true);
    expect(cache.register('abc', 1001)).toBe(false);
  });

  it('evicts expired nonces and accepts a fresh use after TTL', () => {
    const cache = new NonceCache(5_000, 1_000);
    cache.register('n1', 1000);
    expect(cache.size).toBe(1);
    cache.evictExpired(10_000);
    expect(cache.size).toBe(0);
    expect(cache.register('n1', 11_000)).toBe(true);
  });

  it('reset clears all entries', () => {
    const cache = new NonceCache(5_000, 1_000);
    cache.register('n', 1);
    cache.reset();
    expect(cache.size).toBe(0);
  });
});

describe('Plan52 computeCapabilityHash + buildCanonicalInput', () => {
  it('orders capabilities deterministically before hashing', () => {
    const a = computeCapabilityHash(['c', 'a', 'b'], sha256Hex);
    const b = computeCapabilityHash(['a', 'b', 'c'], sha256Hex);
    expect(a).toBe(b);
  });

  it('builds canonical input as pipe-separated sourceId|ts|nonce|hash', () => {
    const input = buildCanonicalInput({
      sourceId: 'transport-http',
      ts: 1_700_000_000,
      nonce: 'deadbeef',
      capabilityHash: 'cafe',
    });
    expect(input).toBe('transport-http|1700000000|deadbeef|cafe');
  });

  it('round-trips through HMAC-SHA256 verify (smoke + canonical formula)', () => {
    const key = Buffer.alloc(32, 0xab);
    const sourceId = 'transport-http';
    const ts = 1_700_000_000;
    const nonce = 'fadedfade';
    const capHash = computeCapabilityHash(['read', 'write'], sha256Hex);
    const canonical = buildCanonicalInput({ sourceId, ts, nonce, capabilityHash: capHash });
    const sig = createHmac('sha256', key).update(canonical, 'utf-8').digest('hex');
    const verify = createHmac('sha256', key).update(canonical, 'utf-8').digest('hex');
    expect(sig).toBe(verify);
  });
});

describe('Plan52 formatTokenSig / parseTokenSig (algorithm prefix discipline)', () => {
  it('round-trips hmac-sha256 prefix', () => {
    const formatted = formatTokenSig('hmac-sha256', 'deadbeef');
    expect(formatted).toBe('hmac-sha256:deadbeef');
    const parsed = parseTokenSig(formatted);
    expect(parsed).toEqual({ algorithm: 'hmac-sha256', signatureHex: 'deadbeef' });
  });

  it('round-trips ed25519 prefix', () => {
    const formatted = formatTokenSig('ed25519', 'cafe');
    const parsed = parseTokenSig(formatted);
    expect(parsed).toEqual({ algorithm: 'ed25519', signatureHex: 'cafe' });
  });

  it('rejects unknown algorithm prefix (NEG-3 algorithm downgrade)', () => {
    expect(parseTokenSig('rsa:abcdef')).toBeNull();
    expect(parseTokenSig('hmac:abcdef')).toBeNull();
  });

  it('rejects malformed input (no colon, empty signature)', () => {
    expect(parseTokenSig('nocolon')).toBeNull();
    expect(parseTokenSig('hmac-sha256:')).toBeNull();
    expect(parseTokenSig(':deadbeef')).toBeNull();
  });
});
