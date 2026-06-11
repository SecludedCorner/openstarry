/**
 * Plan56 D-30-4 — dispatch.ts integration + adversarial tests.
 *
 * NEG-D1..D6 per Plan56 §5.8 + spec clarification A7+A8+A9.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  buildCanonicalInput,
  computeCapabilityHash,
  formatTokenSig,
  type CognitiveMomentContext,
  type VolitionRequest,
} from '@openstarry/sdk';
import { createMultiIVolitionDispatcher } from '../../src/multi-ivolition/dispatch.js';
import { isRedactedFormat } from '../../src/multi-ivolition/redaction.js';

const sha256Hex = (s: string): string =>
  createHash('sha256').update(s, 'utf-8').digest('hex');

const HMAC_KEY_HEX = 'b'.repeat(64);
const HMAC_KEY_BUF = Buffer.from(HMAC_KEY_HEX, 'hex');

function signCanonical(args: {
  parentAgentId: string;
  category: VolitionRequest['category'];
  nonce: string;
  key?: Buffer;
}): string {
  const capabilityHash = computeCapabilityHash([args.category], sha256Hex);
  const canonical = buildCanonicalInput({
    sourceId: args.parentAgentId,
    ts: 0,
    nonce: args.nonce,
    capabilityHash,
  });
  const sig = createHmac('sha256', args.key ?? HMAC_KEY_BUF).update(canonical, 'utf-8').digest('hex');
  return formatTokenSig('hmac-sha256', sig);
}

function buildVolition(over: Partial<VolitionRequest> = {}): VolitionRequest {
  const parentAgentId = over.parentAgentId ?? 'parent-A';
  const category = over.category ?? 'retrieve';
  const nonce = over.nonce ?? randomBytes(16).toString('hex');
  return {
    category,
    parentAgentId,
    parentTokenSig: over.parentTokenSig ?? signCanonical({ parentAgentId, category, nonce }),
    payload: over.payload ?? 'user query fragment',
    priority: over.priority ?? 0.5,
    nonce,
  };
}

function buildContext(volitions: readonly VolitionRequest[], quotaRemaining = 16): CognitiveMomentContext {
  return {
    momentId: 'moment-1',
    parentAgentId: 'parent-A',
    parentQuotaRemaining: quotaRemaining,
    volitions,
  };
}

describe('Plan56 — createMultiIVolitionDispatcher happy path', () => {
  it('processes 3 volitions FIFO and emits 3 successful results', () => {
    const emitted: ReadonlyArray<Record<string, unknown>>[] = [];
    const dispatcher = createMultiIVolitionDispatcher({
      hmacKeyHex: HMAC_KEY_HEX,
      parentCapabilities: ['retrieve', 'verify', 'track-context'],
      onEmit: (sc) => emitted.push([sc]),
    });
    const ctx = buildContext([
      buildVolition({ category: 'retrieve' }),
      buildVolition({ category: 'verify' }),
      buildVolition({ category: 'track-context' }),
    ]);
    const results = dispatcher.processVolitions(ctx);
    expect(results.map((r) => r.success)).toEqual([true, true, true]);
    expect(results.map((r) => r.emit_order)).toEqual([0, 1, 2]);
    expect(emitted).toHaveLength(3);
  });

  it('emits frozen sourceContext containing redacted payload', () => {
    let captured: Record<string, unknown> | undefined;
    const dispatcher = createMultiIVolitionDispatcher({
      hmacKeyHex: HMAC_KEY_HEX,
      parentCapabilities: ['retrieve'],
      onEmit: (sc) => { captured = sc as Record<string, unknown>; },
    });
    const v = buildVolition({ payload: 'sensitive user query 12345' });
    dispatcher.processVolitions(buildContext([v]));
    expect(captured).toBeDefined();
    expect(Object.isFrozen(captured)).toBe(true);
    expect(captured!.volition_payload_redacted).toBe('<redacted-volition-payload len:26 first4:sens>');
    expect(isRedactedFormat(captured!.volition_payload_redacted as string)).toBe(true);
  });
});

describe('Plan56 boot-time refuse-to-start (Plan54 inheritance)', () => {
  it('rejects HMAC key < 32 bytes', () => {
    expect(() =>
      createMultiIVolitionDispatcher({ hmacKeyHex: 'a'.repeat(63), parentCapabilities: [] }),
    ).toThrow(/64 hex chars/);
  });

  it('rejects non-hex HMAC key', () => {
    expect(() =>
      createMultiIVolitionDispatcher({ hmacKeyHex: 'g'.repeat(64), parentCapabilities: [] }),
    ).toThrow(/hex-encoded/);
  });
});

describe('Plan56 NEG-D1..D6 adversarial', () => {
  let dispatcher: ReturnType<typeof createMultiIVolitionDispatcher>;
  let envSnapshot: string | undefined;

  beforeEach(() => {
    envSnapshot = process.env.OPENSTARRY_MAX_VOLITION_QUEUE;
    delete process.env.OPENSTARRY_MAX_VOLITION_QUEUE;
    dispatcher = createMultiIVolitionDispatcher({
      hmacKeyHex: HMAC_KEY_HEX,
      parentCapabilities: ['retrieve', 'verify', 'track-context', 'surface-failure'],
    });
  });
  afterEach(() => {
    if (envSnapshot !== undefined) process.env.OPENSTARRY_MAX_VOLITION_QUEUE = envSnapshot;
    else delete process.env.OPENSTARRY_MAX_VOLITION_QUEUE;
  });

  it('NEG-D1: queue cap exceeded → volition_queue_cap_exceeded', () => {
    process.env.OPENSTARRY_MAX_VOLITION_QUEUE = '2';
    dispatcher = createMultiIVolitionDispatcher({
      hmacKeyHex: HMAC_KEY_HEX,
      parentCapabilities: ['retrieve'],
    });
    const ctx = buildContext([
      buildVolition(), buildVolition(), buildVolition(),
    ]);
    const results = dispatcher.processVolitions(ctx);
    expect(results.length).toBeGreaterThanOrEqual(3);
    const overflowed = results.find((r) => r.reason === 'volition_queue_cap_exceeded');
    expect(overflowed).toBeDefined();
  });

  it('NEG-D2: invalid priority weight rejected by Zod schema', () => {
    const v: VolitionRequest = { ...buildVolition(), priority: 1.5 };
    const results = dispatcher.processVolitions(buildContext([v]));
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.reason).toBe('invalid_request_schema');
  });

  it('NEG-D3: capability bypass attempt → volition_capability_denied', () => {
    const limitedDispatcher = createMultiIVolitionDispatcher({
      hmacKeyHex: HMAC_KEY_HEX,
      parentCapabilities: ['retrieve'], // verify NOT permitted
    });
    const v = buildVolition({ category: 'verify' });
    const results = limitedDispatcher.processVolitions(buildContext([v]));
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.reason).toBe('volition_capability_denied');
  });

  it('NEG-D4: invalid HMAC (wrong key) → tokenSig_verification_failed', () => {
    const wrongKey = Buffer.alloc(32, 0xff);
    const nonce = randomBytes(16).toString('hex');
    const v: VolitionRequest = {
      ...buildVolition({ nonce }),
      parentTokenSig: signCanonical({ parentAgentId: 'parent-A', category: 'retrieve', nonce, key: wrongKey }),
    };
    const results = dispatcher.processVolitions(buildContext([v]));
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.reason).toBe('tokenSig_verification_failed');
  });

  it('NEG-D5: nonce replay within TTL window → nonce_replay (HMAC-keyed dedup per A7)', () => {
    const v = buildVolition();
    const first = dispatcher.processVolitions(buildContext([v]));
    expect(first[0]!.success).toBe(true);
    const replay = dispatcher.processVolitions(buildContext([v]));
    expect(replay[0]!.success).toBe(false);
    expect(replay[0]!.reason).toBe('nonce_replay');
  });

  it('NEG-D6: env var out-of-range falls back to default cap', () => {
    process.env.OPENSTARRY_MAX_VOLITION_QUEUE = '999';
    const fb = createMultiIVolitionDispatcher({
      hmacKeyHex: HMAC_KEY_HEX,
      parentCapabilities: ['retrieve'],
    });
    // Default cap (16) → 17 volitions overflows.
    const ctx = buildContext(Array.from({ length: 17 }, () => buildVolition()));
    const results = fb.processVolitions(ctx);
    const overflowed = results.filter((r) => r.reason === 'volition_queue_cap_exceeded');
    expect(overflowed.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Plan56 §7.3 (Item #6 A9) — per-emission parent quota consumption', () => {
  it('quota exhaustion mid-drain emits parent_quota_exhausted for remaining', () => {
    const dispatcher = createMultiIVolitionDispatcher({
      hmacKeyHex: HMAC_KEY_HEX,
      parentCapabilities: ['retrieve'],
    });
    const ctx = buildContext(
      [buildVolition(), buildVolition(), buildVolition()],
      2, // only 2 quota units
    );
    const results = dispatcher.processVolitions(ctx);
    expect(results[0]!.success).toBe(true);
    expect(results[1]!.success).toBe(true);
    expect(results[2]!.success).toBe(false);
    expect(results[2]!.reason).toBe('parent_quota_exhausted');
  });
});

describe('Plan56 invalid request schema (Plan52 invariant integrity)', () => {
  let dispatcher: ReturnType<typeof createMultiIVolitionDispatcher>;
  beforeEach(() => {
    dispatcher = createMultiIVolitionDispatcher({
      hmacKeyHex: HMAC_KEY_HEX,
      parentCapabilities: ['retrieve'],
    });
  });

  it('rejects empty parentAgentId', () => {
    const v = { ...buildVolition(), parentAgentId: '' } as VolitionRequest;
    const results = dispatcher.processVolitions(buildContext([v]));
    expect(results[0]!.reason).toBe('invalid_request_schema');
  });

  it('rejects nonce shorter than 16 bytes (CV-03)', () => {
    const v = { ...buildVolition(), nonce: 'short' } as VolitionRequest;
    const results = dispatcher.processVolitions(buildContext([v]));
    expect(results[0]!.reason).toBe('invalid_request_schema');
  });

  it('rejects malformed tokenSig (no algo prefix)', () => {
    const v = { ...buildVolition(), parentTokenSig: 'plainsig' } as VolitionRequest;
    const results = dispatcher.processVolitions(buildContext([v]));
    expect(results[0]!.reason).toBe('invalid_request_schema');
  });
});
