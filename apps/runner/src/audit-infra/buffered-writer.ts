/**
 * audit-infra/buffered-writer — W0 Plan48 shared infra.
 *
 * Generic ring-buffer writer with configurable max-size, overflow callback,
 * and synchronous flush-on-shutdown hook. Shared by structured-log (§2.1)
 * and audit-sink (§2.2) to avoid double-implementation (Plan48 §15.2).
 *
 * Layer: Runner (NOT Core; MR-6 preserved).
 *
 * @since Plan48 W0 shared infra
 */

export interface BufferedWriterOptions<T> {
  readonly maxSize: number;
  readonly flush: (items: readonly T[]) => void;
  readonly onOverflow?: (dropped: T) => void;
}

/**
 * Ring-buffer writer. `push(item)` appends; on overflow, the oldest entry is
 * dropped and `onOverflow` fires (C48-M1d / C48-M2f back-pressure contract).
 * `flushSync()` drains the buffer via the configured `flush` callback and
 * clears it; intended for shutdown paths (C48-M1e / C48-M2g).
 */
export class BufferedWriter<T> {
  private readonly buf: T[] = [];
  private readonly maxSize: number;
  private readonly flushFn: (items: readonly T[]) => void;
  private readonly overflowFn?: (dropped: T) => void;
  private droppedCount = 0;

  constructor(opts: BufferedWriterOptions<T>) {
    if (!Number.isInteger(opts.maxSize) || opts.maxSize <= 0) {
      throw new Error(`BufferedWriter: maxSize must be a positive integer (got ${opts.maxSize})`);
    }
    this.maxSize = opts.maxSize;
    this.flushFn = opts.flush;
    this.overflowFn = opts.onOverflow;
  }

  push(item: T): void {
    if (this.buf.length >= this.maxSize) {
      const dropped = this.buf.shift() as T;
      this.droppedCount += 1;
      this.overflowFn?.(dropped);
    }
    this.buf.push(item);
  }

  flushSync(): number {
    if (this.buf.length === 0) return 0;
    const items = this.buf.slice();
    this.buf.length = 0;
    this.flushFn(items);
    return items.length;
  }

  get size(): number {
    return this.buf.length;
  }

  get capacity(): number {
    return this.maxSize;
  }

  get droppedTotal(): number {
    return this.droppedCount;
  }

  peek(): readonly T[] {
    return this.buf.slice();
  }
}
