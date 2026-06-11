/**
 * C48-M1b schema + MRB-12 §12.2 JSON edge-case coverage.
 */

import { describe, expect, it } from 'vitest';
import {
  safeStringify,
  CIRCULAR_SENTINEL,
  TRUNCATION_SENTINEL,
  MAX_STRING_LEN,
} from '../../src/structured-log/safe-stringify.js';

describe('safe-stringify', () => {
  it('round-trips simple objects', () => {
    expect(JSON.parse(safeStringify({ a: 1, b: 'x' }))).toEqual({ a: 1, b: 'x' });
  });

  it('handles circular references without throwing', () => {
    const a: any = { name: 'a' };
    a.self = a;
    const out = safeStringify(a);
    expect(out).toContain(CIRCULAR_SENTINEL);
    // Verify JSON is still parseable.
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('coerces BigInt to string primitive', () => {
    const out = safeStringify({ big: 12345678901234567890n });
    const parsed = JSON.parse(out);
    expect(typeof parsed.big).toBe('string');
    expect(parsed.big).toBe('12345678901234567890n');
  });

  it('truncates very long strings with sentinel', () => {
    const big = 'x'.repeat(MAX_STRING_LEN + 100);
    const out = safeStringify({ big });
    const parsed = JSON.parse(out);
    expect(parsed.big.length).toBe(MAX_STRING_LEN + TRUNCATION_SENTINEL.length);
    expect(parsed.big.endsWith(TRUNCATION_SENTINEL)).toBe(true);
  });

  it('serialises Error instances with name/message/stack', () => {
    const err = new RangeError('bad input');
    const parsed = JSON.parse(safeStringify({ err }));
    expect(parsed.err.name).toBe('RangeError');
    expect(parsed.err.message).toBe('bad input');
    expect(typeof parsed.err.stack).toBe('string');
  });

  it('never throws — falls back to diagnostic envelope on pathological input', () => {
    const weird: any = {};
    weird.toJSON = () => { throw new Error('nope'); };
    const out = safeStringify(weird);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).toMatch(/__serialization_error/);
  });
});
