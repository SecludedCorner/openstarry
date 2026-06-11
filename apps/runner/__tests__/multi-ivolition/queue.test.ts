/**
 * Plan56 §2.3 — VolitionQueue tests (SICP queue-as-stream FIFO).
 */

import { describe, expect, it } from 'vitest';
import type { VolitionRequest } from '@openstarry/sdk';
import { VolitionQueue } from '../../src/multi-ivolition/queue.js';

const stub = (n: number): VolitionRequest => ({
  category: 'retrieve',
  parentAgentId: 'p',
  parentTokenSig: `hmac-sha256:${'a'.repeat(64)}`,
  payload: `payload-${n}`,
  priority: 0.5,
  nonce: 'a'.repeat(32),
});

describe('Plan56 §2.3 — VolitionQueue', () => {
  it('enqueue + drain FIFO order', () => {
    const q = new VolitionQueue(4);
    q.enqueue(stub(1));
    q.enqueue(stub(2));
    q.enqueue(stub(3));
    const drained = q.drain();
    expect(drained.map((v) => v.payload)).toEqual(['payload-1', 'payload-2', 'payload-3']);
  });

  it('drain clears the queue (kṣaṇika emission discipline)', () => {
    const q = new VolitionQueue(4);
    q.enqueue(stub(1));
    q.drain();
    expect(q.isEmpty).toBe(true);
    expect(q.size).toBe(0);
  });

  it('NEG-D1: enqueue returns false at capacity', () => {
    const q = new VolitionQueue(2);
    expect(q.enqueue(stub(1))).toBe(true);
    expect(q.enqueue(stub(2))).toBe(true);
    expect(q.atCapacity).toBe(true);
    expect(q.enqueue(stub(3))).toBe(false); // capacity exceeded
  });

  it('rejects invalid capacity at construction', () => {
    expect(() => new VolitionQueue(0)).toThrow(/positive integer/);
    expect(() => new VolitionQueue(-1)).toThrow();
    expect(() => new VolitionQueue(1.5)).toThrow();
  });

  it('size tracks correctly through enqueue/drain cycles', () => {
    const q = new VolitionQueue(4);
    expect(q.size).toBe(0);
    q.enqueue(stub(1));
    q.enqueue(stub(2));
    expect(q.size).toBe(2);
    q.drain();
    expect(q.size).toBe(0);
  });
});
