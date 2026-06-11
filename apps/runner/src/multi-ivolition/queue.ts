/**
 * multi-ivolition / queue — Plan56 §2.3 SICP queue-as-stream.
 *
 * **R3 A1 22/1**: Option A single-stream multi-volition queue. Per-cognitive
 * -moment FIFO; init + drain + discard; no persistent state across moments
 * (kṣaṇika emission discipline).
 *
 * @see research record/cycle03-18/deliver/O1_D30_4_Plan56_implementation_final.md §2.3
 */

import type { VolitionRequest } from '@openstarry/sdk';

/** Per-moment FIFO queue (Plan56 §2.3 SICP queue-as-stream). */
export class VolitionQueue {
  private readonly items: VolitionRequest[] = [];

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`VolitionQueue: capacity must be a positive integer, got ${capacity}`);
    }
  }

  /** Enqueue; returns false if at capacity (NEG-D1 cap enforcement). */
  enqueue(item: VolitionRequest): boolean {
    if (this.items.length >= this.capacity) return false;
    this.items.push(item);
    return true;
  }

  /** Drain: returns all queued items in FIFO order; clears the queue. */
  drain(): readonly VolitionRequest[] {
    const drained = this.items.slice();
    this.items.length = 0;
    return drained;
  }

  get size(): number {
    return this.items.length;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  get atCapacity(): boolean {
    return this.items.length >= this.capacity;
  }
}
