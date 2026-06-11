/**
 * audit-sink/sink — C48-M2a + C48-M2c + C48-M2d + C48-M2f + C48-M2g.
 *
 * Subscribes to the AuditBus at runner startup, applies (timestamp,
 * event_hash) dedup, and appends JSONL lines via a BufferedWriter (shared
 * back-pressure with structured-log, C48-M2f ⇔ C48-M1d). Shutdown flush
 * (C48-M2g ⇔ C48-M1e) is registered with the shared shutdown hook registry
 * at `SHUTDOWN_ORDER.FLUSH_AUDIT_SINK` (300), after structured-log flush.
 *
 * Layer: Runner (NOT Core; NOT plugin) — per Plan48 §2.2.
 *
 * @since Plan48 C48-M2
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BufferedWriter } from '../audit-infra/buffered-writer.js';
import {
  SHUTDOWN_ORDER,
  type ShutdownHookRegistry,
} from '../audit-infra/shutdown-hooks.js';
import { safeStringify } from '../structured-log/safe-stringify.js';
import type { AuditBus, AuditEvent, AuditEventType } from './audit-bus.js';
import type { AuditSinkConfig } from './config.js';
import { resolveAuditSinkConfig } from './config.js';
import { dedupeKey, DedupeWindow } from './dedupe.js';

export const AUDIT_SINK_SHUTDOWN_ID = 'audit-sink.flush';
export const AUDIT_OVERFLOW_EVENT = 'W_AUDIT_OVERFLOW';

const SUBSCRIBED_TYPES: readonly AuditEventType[] = [
  'capability_denied',
  'ws_connection_denied',
];

export interface AuditSinkOptions {
  readonly bus: AuditBus;
  readonly config?: Partial<AuditSinkConfig>;
  readonly sinkFn?: (line: string) => void;
}

export interface AuditSinkStats {
  readonly written: number;
  readonly dropped: number;
  readonly duplicates: number;
  readonly buffered: number;
}

/**
 * Audit-sink subscriber. Construct, then `attach()` to subscribe and
 * `detach()` (or shutdown-hook) to unsubscribe + flush.
 */
export class AuditSink {
  readonly config: AuditSinkConfig;
  private readonly bus: AuditBus;
  private readonly buffer: BufferedWriter<string>;
  private readonly dedupe: DedupeWindow;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly sinkFn: (line: string) => void;
  private written = 0;
  private duplicates = 0;
  private overflowReported = false;
  private attached = false;

  constructor(opts: AuditSinkOptions) {
    this.bus = opts.bus;
    this.config = resolveAuditSinkConfig(opts.config);
    this.dedupe = new DedupeWindow(this.config.dedupeWindow);
    this.sinkFn = opts.sinkFn ?? this.defaultFileSink.bind(this);
    this.buffer = new BufferedWriter<string>({
      maxSize: this.config.maxBufferSize,
      flush: (items) => {
        for (const line of items) {
          this.sinkFn(line);
          this.written += 1;
        }
      },
      onOverflow: () => {
        if (!this.overflowReported) {
          this.overflowReported = true;
          const warnLine = safeStringify({
            type: AUDIT_OVERFLOW_EVENT,
            source: 'audit-sink',
            maxBufferSize: this.buffer.capacity,
          });
          try { this.sinkFn(warnLine); } catch { /* best-effort */ }
        }
      },
    });
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    for (const type of SUBSCRIBED_TYPES) {
      const unsub = this.bus.subscribe(type, (e) => { this.onEvent(e); });
      this.unsubscribers.push(unsub);
    }
  }

  detach(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers.length = 0;
    this.attached = false;
  }

  registerShutdown(registry: ShutdownHookRegistry): void {
    registry.register({
      id: AUDIT_SINK_SHUTDOWN_ID,
      order: SHUTDOWN_ORDER.FLUSH_AUDIT_SINK,
      fn: () => { this.flushSync(); },
    });
  }

  flushSync(): number {
    return this.buffer.flushSync();
  }

  stats(): AuditSinkStats {
    return {
      written: this.written,
      dropped: this.buffer.droppedTotal,
      duplicates: this.duplicates,
      buffered: this.buffer.size,
    };
  }

  /** Test hook: observe an event without going through the bus. */
  ingest(event: AuditEvent): void {
    this.onEvent(event);
  }

  private onEvent(event: AuditEvent): void {
    const key = dedupeKey(event);
    if (!this.dedupe.observe(key)) {
      this.duplicates += 1;
      return;
    }
    const line = safeStringify({ ...event, audit_key: key });
    this.buffer.push(line);
  }

  private defaultFileSink(line: string): void {
    try {
      mkdirSync(dirname(this.config.path), { recursive: true });
    } catch { /* best-effort */ }
    appendFileSync(this.config.path, `${line}\n`, 'utf-8');
  }
}
