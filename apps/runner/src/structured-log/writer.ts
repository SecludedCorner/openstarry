/**
 * structured-log/writer — C48-M1a + C48-M1b + C48-M1c + C48-M1d.
 *
 * Self-built, zero-external-dep structured-log writer. Emits JSON lines of
 * shape {timestamp, level, event, payload} (C48-M1b), filters by level via
 * `LOG_LEVEL` (C48-M1c), uses a ring-buffer with back-pressure emitting
 * `W_AUDIT_OVERFLOW` on overflow (C48-M1d).
 *
 * Plan48 §2.1 rationale: Core architecture (MR-6) forbids depending on
 * external logging libraries for policy-path observability; the writer is
 * self-built and ships in runner layer.
 *
 * Layer: Runner (NOT Core; MR-6 preserved).
 *
 * @since Plan48 C48-M1
 */

import { appendFileSync, openSync, closeSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { BufferedWriter } from '../audit-infra/buffered-writer.js';
import { envEnum, envInt, envString } from '../audit-infra/env-parse.js';
import { isoTimestamp } from '../audit-infra/iso-timestamp.js';
import { safeStringify } from './safe-stringify.js';

export const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  FATAL: 50,
};

export interface StructuredLogRecord {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly event: string;
  readonly payload: unknown;
}

export interface StructuredLogWriterOptions {
  readonly level?: LogLevel;
  readonly maxBufferSize?: number;
  readonly outputPath?: string;
  readonly sinkFn?: (line: string) => void;
}

export const DEFAULT_MAX_BUFFER = 1024;
export const OVERFLOW_EVENT = 'W_AUDIT_OVERFLOW';

/**
 * Structured-log writer. Lines are serialized immediately (preserving
 * ordering) but flushed to the underlying sink lazily via the ring buffer.
 * `flushSync()` drains the buffer, used by the shutdown hook (C48-M1e).
 */
export class StructuredLogWriter {
  readonly level: LogLevel;
  readonly outputPath: string | undefined;
  private readonly buffer: BufferedWriter<string>;
  private readonly sinkFn: (line: string) => void;
  private overflowReported = false;

  constructor(opts: StructuredLogWriterOptions = {}) {
    this.level = opts.level
      ?? envEnum<LogLevel>('LOG_LEVEL', LOG_LEVELS, 'INFO');
    this.outputPath = opts.outputPath
      ?? (process.env['OPENSTARRY_LOG_PATH'] || undefined);
    const maxSize = opts.maxBufferSize
      ?? envInt('OPENSTARRY_LOG_BUFFER_MAX', DEFAULT_MAX_BUFFER);

    this.sinkFn = opts.sinkFn ?? this.defaultFileSink.bind(this);

    this.buffer = new BufferedWriter<string>({
      maxSize,
      flush: (items) => {
        for (const line of items) this.sinkFn(line);
      },
      onOverflow: () => {
        if (!this.overflowReported) {
          this.overflowReported = true;
          const overflowLine = this.serialize({
            timestamp: isoTimestamp(),
            level: 'WARN',
            event: OVERFLOW_EVENT,
            payload: { maxBufferSize: this.buffer.capacity },
          });
          // Do NOT recurse into push() — write directly to sink so the
          // back-pressure signal itself cannot be dropped.
          try {
            this.sinkFn(overflowLine);
          } catch {
            /* best-effort; audit path must not crash caller */
          }
        }
      },
    });
  }

  emit(level: LogLevel, event: string, payload?: unknown): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return;
    const record: StructuredLogRecord = {
      timestamp: isoTimestamp(),
      level,
      event,
      payload: payload ?? null,
    };
    const line = this.serialize(record);
    this.buffer.push(line);
  }

  debug(event: string, payload?: unknown): void { this.emit('DEBUG', event, payload); }
  info(event: string, payload?: unknown): void { this.emit('INFO', event, payload); }
  warn(event: string, payload?: unknown): void { this.emit('WARN', event, payload); }
  error(event: string, payload?: unknown): void { this.emit('ERROR', event, payload); }
  fatal(event: string, payload?: unknown): void { this.emit('FATAL', event, payload); }

  flushSync(): number {
    return this.buffer.flushSync();
  }

  get bufferSize(): number {
    return this.buffer.size;
  }

  get droppedTotal(): number {
    return this.buffer.droppedTotal;
  }

  resetOverflowReported(): void {
    this.overflowReported = false;
  }

  private serialize(record: StructuredLogRecord): string {
    return safeStringify(record);
  }

  private defaultFileSink(line: string): void {
    if (!this.outputPath) {
      process.stderr.write(`${line}\n`);
      return;
    }
    try {
      mkdirSync(dirname(this.outputPath), { recursive: true });
    } catch { /* best-effort */ }
    appendFileSync(this.outputPath, `${line}\n`, 'utf-8');
  }
}

/** Convenience: resolve the active path for a writer (may be undefined). */
export function resolveLogPath(): string | undefined {
  const raw = envString('OPENSTARRY_LOG_PATH', '');
  return raw === '' ? undefined : raw;
}

/** Open + return an fs descriptor for sync writes (shutdown path). */
export function openSyncSink(path: string): {
  fd: number;
  write: (line: string) => void;
  close: () => void;
} {
  try { mkdirSync(dirname(path), { recursive: true }); } catch { /* ignore */ }
  const fd = openSync(path, 'a');
  return {
    fd,
    write: (line: string) => { writeSync(fd, `${line}\n`); },
    close: () => { closeSync(fd); },
  };
}
