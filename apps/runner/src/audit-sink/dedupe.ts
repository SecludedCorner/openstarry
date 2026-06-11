/**
 * audit-sink/dedupe — C48-M2b dedup + ordering.
 *
 * De-duplicates audit events via a `(timestamp, event_hash)` composite key
 * per Plan48 §2.2 + §3.2. The event_hash is a stable short digest of the
 * event's type-specific identifying fields.
 *
 * Ordering is preserved by accepting the first-seen event and rejecting
 * any subsequent duplicate with the same key.
 *
 * @since Plan48 C48-M2b
 */

import { createHash } from 'node:crypto';
import type { AuditEvent } from './audit-bus.js';

export function hashEvent(event: AuditEvent): string {
  const payload = identifyingFields(event);
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function identifyingFields(event: AuditEvent): string {
  if (event.type === 'capability_denied') {
    return `${event.type}|${event.plugin}|${event.tool}`;
  }
  return `${event.type}|${event.reason}|${event.remote ?? ''}|${event.origin ?? ''}`;
}

export function dedupeKey(event: AuditEvent): string {
  return `${event.timestamp}|${hashEvent(event)}`;
}

/**
 * Bounded dedup window. Holds up to `capacity` recent keys (FIFO evict) —
 * this prevents unbounded memory growth on a long-running process while
 * still catching the common case (same event within the current write
 * batch or within the last few seconds of tool filtering).
 */
export class DedupeWindow {
  private readonly capacity: number;
  private readonly order: string[] = [];
  private readonly keys = new Set<string>();

  constructor(capacity = 1024) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`DedupeWindow: capacity must be a positive integer`);
    }
    this.capacity = capacity;
  }

  isDuplicate(key: string): boolean {
    return this.keys.has(key);
  }

  /** Returns true if the key is newly accepted; false if duplicate. */
  observe(key: string): boolean {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    this.order.push(key);
    if (this.order.length > this.capacity) {
      const evicted = this.order.shift();
      if (evicted !== undefined) this.keys.delete(evicted);
    }
    return true;
  }

  get size(): number {
    return this.keys.size;
  }
}
