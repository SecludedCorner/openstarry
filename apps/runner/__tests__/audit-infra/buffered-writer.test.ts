/**
 * W0 shared infra — BufferedWriter unit tests.
 * Covers shared behaviour relied on by C48-M1d + C48-M2f (back-pressure)
 * and C48-M1e + C48-M2g (flushSync).
 */

import { describe, expect, it, vi } from 'vitest';
import { BufferedWriter } from '../../src/audit-infra/buffered-writer.js';

describe('BufferedWriter', () => {
  it('rejects non-positive maxSize', () => {
    expect(() => new BufferedWriter<number>({ maxSize: 0, flush: () => {} })).toThrow();
    expect(() => new BufferedWriter<number>({ maxSize: -1, flush: () => {} })).toThrow();
    expect(() => new BufferedWriter<number>({ maxSize: 1.5, flush: () => {} })).toThrow();
  });

  it('pushes up to capacity without overflow', () => {
    const flush = vi.fn();
    const w = new BufferedWriter<number>({ maxSize: 3, flush });
    w.push(1);
    w.push(2);
    w.push(3);
    expect(w.size).toBe(3);
    expect(w.droppedTotal).toBe(0);
  });

  it('drops FIFO and fires onOverflow once buffer is full', () => {
    const flush = vi.fn();
    const onOverflow = vi.fn();
    const w = new BufferedWriter<number>({ maxSize: 2, flush, onOverflow });
    w.push(1);
    w.push(2);
    w.push(3); // drops 1
    w.push(4); // drops 2
    expect(w.droppedTotal).toBe(2);
    expect(onOverflow).toHaveBeenCalledTimes(2);
    expect(onOverflow).toHaveBeenNthCalledWith(1, 1);
    expect(onOverflow).toHaveBeenNthCalledWith(2, 2);
    expect(w.peek()).toEqual([3, 4]);
  });

  it('flushSync drains buffer and calls flush callback once', () => {
    const flush = vi.fn();
    const w = new BufferedWriter<number>({ maxSize: 10, flush });
    w.push(1);
    w.push(2);
    const drained = w.flushSync();
    expect(drained).toBe(2);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith([1, 2]);
    expect(w.size).toBe(0);
  });

  it('flushSync on empty buffer is a noop (returns 0, does not invoke flush)', () => {
    const flush = vi.fn();
    const w = new BufferedWriter<number>({ maxSize: 10, flush });
    expect(w.flushSync()).toBe(0);
    expect(flush).not.toHaveBeenCalled();
  });
});
