/**
 * Plan54 §4.1 + §6 — spawn.ts integration + adversarial tests.
 *
 * Covers happy path + Batch 14 Item #3 boot-time refuse-to-start +
 * NEG-1..NEG-7 adversarial coverage adapted from cycle 03-14 Plan52 pattern.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildCanonicalInput,
  computeCapabilityHash,
  formatTokenSig,
  type SpawnChildRequest,
} from '@openstarry/sdk';
import { createAgentComposer } from '../../src/agent-composition/spawn.js';

const sha256Hex = (s: string): string =>
  createHash('sha256').update(s, 'utf-8').digest('hex');

const HMAC_KEY_HEX = 'a'.repeat(64); // 32 bytes hex
const HMAC_KEY_BUF = Buffer.from(HMAC_KEY_HEX, 'hex');

function signCanonical(args: {
  parentAgentId: string;
  capability: string;
  nonce: string;
  key?: Buffer;
}): string {
  const capabilityHash = computeCapabilityHash([args.capability], sha256Hex);
  const canonical = buildCanonicalInput({
    sourceId: args.parentAgentId,
    ts: 0,
    nonce: args.nonce,
    capabilityHash,
  });
  const sig = createHmac('sha256', args.key ?? HMAC_KEY_BUF).update(canonical, 'utf-8').digest('hex');
  return formatTokenSig('hmac-sha256', sig);
}

function buildValidRequest(over: Partial<SpawnChildRequest> = {}): SpawnChildRequest {
  const parentAgentId = over.parentAgentId ?? 'parent-A';
  const capability = over.childAgentSpec?.capability ?? 'read';
  const nonce = over.nonce ?? randomBytes(16).toString('hex');
  return {
    parentAgentId,
    parentTokenSig: over.parentTokenSig ?? signCanonical({ parentAgentId, capability, nonce }),
    childAgentSpec: over.childAgentSpec ?? { capability, config: {} },
    spawnDepth: over.spawnDepth ?? 1,
    nonce,
    spawnId: over.spawnId,
  };
}

describe('Plan54 §4.1 — createAgentComposer happy path', () => {
  it('successful spawn returns childAgentId + childTokenSig + state=spawned', async () => {
    const composer = createAgentComposer({
      hmacKeyHex: HMAC_KEY_HEX,
      parentCapabilities: ['read', 'write'],
    });
    const result = await composer.spawnChild(buildValidRequest());
    expect(result.success).toBe(true);
    expect(result.state).toBe('spawned');
    expect(result.childAgentId).toMatch(/^parent-A\//);
    expect(result.childTokenSig).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    expect(result.spawnId).toBeDefined();
    expect(composer.lifecycle.activeCount()).toBe(1);
  });
});

describe('Plan54 §6 — Batch 14 Item #3 boot-time refuse-to-start', () => {
  it('rejects HMAC key < 32 bytes / 64 hex chars', () => {
    expect(() =>
      createAgentComposer({ hmacKeyHex: 'a'.repeat(63), parentCapabilities: [] }),
    ).toThrow(/CSPRNG provenance/);
  });

  it('rejects non-hex HMAC key', () => {
    expect(() =>
      createAgentComposer({ hmacKeyHex: 'g'.repeat(64), parentCapabilities: [] }),
    ).toThrow(/hex-encoded/);
  });

  it('accepts a valid 32-byte hex key', () => {
    expect(() =>
      createAgentComposer({ hmacKeyHex: HMAC_KEY_HEX, parentCapabilities: ['read'] }),
    ).not.toThrow();
  });

  it('falls back to randomBytes(32) when key omitted (CSPRNG)', () => {
    expect(() =>
      createAgentComposer({ parentCapabilities: ['read'] }),
    ).not.toThrow();
  });
});

describe('Plan54 NEG-1..NEG-7 adversarial', () => {
  let composer: ReturnType<typeof createAgentComposer>;
  beforeEach(() => {
    composer = createAgentComposer({
      hmacKeyHex: HMAC_KEY_HEX,
      parentCapabilities: ['read', 'write'],
    });
  });

  it('NEG-1: rejects forged signature (wrong key)', async () => {
    const wrongKey = Buffer.alloc(32, 0xff);
    const req = buildValidRequest({
      parentTokenSig: signCanonical({ parentAgentId: 'parent-A', capability: 'read', nonce: randomBytes(16).toString('hex'), key: wrongKey }),
    });
    const result = await composer.spawnChild(req);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('tokenSig_verification_failed');
  });

  it('NEG-2: rejects nonce replay', async () => {
    const req = buildValidRequest();
    const first = await composer.spawnChild(req);
    expect(first.success).toBe(true);
    const replay = await composer.spawnChild(req);
    expect(replay.success).toBe(false);
    expect(replay.reason).toBe('nonce_replay');
  });

  it('NEG-3: rejects missing algo-prefix', async () => {
    const req = buildValidRequest({
      parentTokenSig: 'plainsignaturewithnoprefix1234567890abcdef1234567890abcdef1234567890abcdef1234',
    });
    const result = await composer.spawnChild(req);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('invalid_request_schema');
  });

  it('NEG-4: rejects nonce shorter than 16 bytes (CV-03)', async () => {
    const req = buildValidRequest({ nonce: 'short' });
    const result = await composer.spawnChild(req);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('invalid_request_schema');
  });

  it('NEG-5: rejects spawnDepth exceeding default MAX_SPAWN_DEPTH=4', async () => {
    const req = buildValidRequest({ spawnDepth: 4 }); // 4 + 1 = 5 > 4
    const result = await composer.spawnChild(req);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('max_spawn_depth_exceeded');
  });

  it('NEG-6: rejects out-of-capability child', async () => {
    const nonce = randomBytes(16).toString('hex');
    const req: SpawnChildRequest = {
      parentAgentId: 'parent-A',
      parentTokenSig: signCanonical({ parentAgentId: 'parent-A', capability: 'admin', nonce }),
      childAgentSpec: { capability: 'admin', config: {} },
      spawnDepth: 1,
      nonce,
    };
    // The signature is valid; capability matches request; but 'admin' ∉ parentCapabilities.
    const result = await composer.spawnChild(req);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('invalid_request_schema');
  });

  it('NEG-7: rejects on parent quota exhaustion (8th spawn)', async () => {
    for (let i = 0; i < 8; i++) {
      const result = await composer.spawnChild(buildValidRequest());
      expect(result.success).toBe(true);
    }
    const ninth = await composer.spawnChild(buildValidRequest());
    expect(ninth.success).toBe(false);
    expect(ninth.reason).toBe('parent_quota_exhausted');
  });
});

describe('Plan54 — invalid_request_schema rejection (Zod gate)', () => {
  it('rejects empty parentAgentId', async () => {
    const composer = createAgentComposer({ hmacKeyHex: HMAC_KEY_HEX, parentCapabilities: ['read'] });
    const req = buildValidRequest({ parentAgentId: '' });
    const result = await composer.spawnChild(req);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('invalid_request_schema');
  });

  it('rejects negative spawnDepth', async () => {
    const composer = createAgentComposer({ hmacKeyHex: HMAC_KEY_HEX, parentCapabilities: ['read'] });
    const req = { ...buildValidRequest(), spawnDepth: -1 };
    const result = await composer.spawnChild(req);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('invalid_request_schema');
  });
});
