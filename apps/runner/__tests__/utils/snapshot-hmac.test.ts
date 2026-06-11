/**
 * Plan47 C47-K3-M1/M5 — HMAC + nonce sign / verify / replay tests.
 */

import { describe, it, expect } from 'vitest';
import {
  signSnapshotPayload,
  verifySnapshotPayload,
  generateNonce,
  normalizeHmacKey,
  NonceRegistry,
  SNAPSHOT_MIN_KEY_LENGTH_BYTES,
} from '../../src/utils/snapshot-hmac.js';

const KEY = 'a'.repeat(SNAPSHOT_MIN_KEY_LENGTH_BYTES * 2); // 64 hex chars = 32 bytes

describe('snapshot-hmac sign/verify', () => {
  it('round-trip verifies a correctly signed payload', () => {
    const payload = '{"hello":"world"}';
    const env = signSnapshotPayload(payload, KEY);
    const res = verifySnapshotPayload(payload, env, KEY);
    expect(res.ok).toBe(true);
  });

  it('tampered payload fails verification', () => {
    const env = signSnapshotPayload('{"hello":"world"}', KEY);
    const res = verifySnapshotPayload('{"hello":"tampered"}', env, KEY);
    expect(res.ok).toBe(false);
  });

  it('wrong key fails verification', () => {
    const env = signSnapshotPayload('payload', KEY);
    const otherKey = 'b'.repeat(64);
    const res = verifySnapshotPayload('payload', env, otherKey);
    expect(res.ok).toBe(false);
  });

  it('tampered signedAt fails verification', () => {
    const env = signSnapshotPayload('payload', KEY);
    const tampered = { ...env, signedAt: env.signedAt + 1 };
    const res = verifySnapshotPayload('payload', tampered, KEY);
    expect(res.ok).toBe(false);
  });

  it('rejects too-short key', () => {
    expect(() => normalizeHmacKey('short')).toThrow(/>= 32 bytes/);
  });

  it('generateNonce produces 16 bytes', () => {
    const n = generateNonce();
    expect(n.length).toBe(16);
  });
});

describe('NonceRegistry', () => {
  it('accepts fresh nonces and rejects duplicates', () => {
    const reg = new NonceRegistry();
    expect(reg.register('abc')).toBe(true);
    expect(reg.register('abc')).toBe(false);
    expect(reg.register('def')).toBe(true);
    expect(reg.size).toBe(2);
  });

  it('reset clears all observed nonces', () => {
    const reg = new NonceRegistry();
    reg.register('abc');
    reg.reset();
    expect(reg.size).toBe(0);
    expect(reg.register('abc')).toBe(true);
  });
});
