/**
 * C48-M2b dedup + ordering.
 */

import { describe, expect, it } from 'vitest';
import {
  DedupeWindow,
  dedupeKey,
  hashEvent,
} from '../../src/audit-sink/dedupe.js';
import type {
  CapabilityDeniedEvent,
  WsConnectionDeniedEvent,
} from '../../src/audit-sink/audit-bus.js';

const ts = '2026-04-25T00:00:00.000Z';

const cap: CapabilityDeniedEvent = {
  type: 'capability_denied',
  plugin: 'p1',
  tool: 't1',
  allowedTools: ['t0'],
  timestamp: ts,
};

const wsDeny: WsConnectionDeniedEvent = {
  type: 'ws_connection_denied',
  reason: 'origin_blocked',
  remote: '192.0.2.1',
  origin: 'https://evil.example',
  timestamp: ts,
};

describe('hashEvent', () => {
  it('is stable for identical identifying fields', () => {
    expect(hashEvent(cap)).toBe(hashEvent({ ...cap, allowedTools: ['t9'] }));
  });
  it('differs when tool changes', () => {
    expect(hashEvent(cap)).not.toBe(hashEvent({ ...cap, tool: 't2' }));
  });
  it('differs across event types', () => {
    expect(hashEvent(cap)).not.toBe(hashEvent(wsDeny));
  });
});

describe('dedupeKey', () => {
  it('combines timestamp with hash', () => {
    const key = dedupeKey(cap);
    expect(key.startsWith(ts)).toBe(true);
    expect(key.includes('|')).toBe(true);
  });
});

describe('DedupeWindow', () => {
  it('observes first occurrence, rejects duplicates', () => {
    const w = new DedupeWindow(4);
    const k = dedupeKey(cap);
    expect(w.observe(k)).toBe(true);
    expect(w.observe(k)).toBe(false);
    expect(w.isDuplicate(k)).toBe(true);
  });

  it('evicts oldest key when over capacity (FIFO)', () => {
    const w = new DedupeWindow(2);
    expect(w.observe('a')).toBe(true);
    expect(w.observe('b')).toBe(true);
    // 'c' pushes out 'a' (FIFO) — window now holds {b, c}.
    expect(w.observe('c')).toBe(true);
    expect(w.isDuplicate('a')).toBe(false);
    expect(w.isDuplicate('b')).toBe(true);
    expect(w.isDuplicate('c')).toBe(true);
    // Re-adding 'a' pushes out 'b'; window now holds {c, a}.
    expect(w.observe('a')).toBe(true);
    expect(w.isDuplicate('b')).toBe(false);
    expect(w.isDuplicate('c')).toBe(true);
    expect(w.isDuplicate('a')).toBe(true);
  });

  it('rejects invalid capacity', () => {
    expect(() => new DedupeWindow(0)).toThrow();
    expect(() => new DedupeWindow(-1)).toThrow();
  });
});
