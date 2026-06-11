/**
 * C48-M1a / M1b / M1c / M1d / M1e unit tests.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  StructuredLogWriter,
  OVERFLOW_EVENT,
} from '../../src/structured-log/writer.js';
import { registerStructuredLogShutdown } from '../../src/structured-log/shutdown.js';
import { createShutdownHookRegistry } from '../../src/audit-infra/shutdown-hooks.js';

function capture(): { sinkFn: (line: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { sinkFn: (l) => lines.push(l), lines };
}

beforeEach(() => {
  delete process.env['LOG_LEVEL'];
  delete process.env['OPENSTARRY_LOG_BUFFER_MAX'];
});

afterEach(() => {
  delete process.env['LOG_LEVEL'];
  delete process.env['OPENSTARRY_LOG_BUFFER_MAX'];
});

describe('StructuredLogWriter (C48-M1)', () => {
  it('C48-M1b: emits JSON with {timestamp, level, event, payload}', () => {
    const { sinkFn, lines } = capture();
    const w = new StructuredLogWriter({ sinkFn });
    w.info('runner.boot', { phase: 1 });
    w.flushSync();
    const parsed = JSON.parse(lines[0]);
    expect(typeof parsed.timestamp).toBe('string');
    expect(parsed.level).toBe('INFO');
    expect(parsed.event).toBe('runner.boot');
    expect(parsed.payload).toEqual({ phase: 1 });
  });

  it('C48-M1c: LOG_LEVEL=WARN suppresses DEBUG + INFO', () => {
    const { sinkFn, lines } = capture();
    const w = new StructuredLogWriter({ level: 'WARN', sinkFn });
    w.debug('d', 1);
    w.info('i', 1);
    w.warn('w', 1);
    w.error('e', 1);
    w.fatal('f', 1);
    w.flushSync();
    const events = lines.map((l) => JSON.parse(l).event);
    expect(events).toEqual(['w', 'e', 'f']);
  });

  it('C48-M1c: LOG_LEVEL env var honored when options unset', () => {
    process.env['LOG_LEVEL'] = 'error';
    const { sinkFn, lines } = capture();
    const w = new StructuredLogWriter({ sinkFn });
    w.info('i');
    w.warn('w');
    w.error('e');
    w.flushSync();
    expect(lines.map((l) => JSON.parse(l).event)).toEqual(['e']);
  });

  it('C48-M1d: overflow emits one W_AUDIT_OVERFLOW warn and drops FIFO', () => {
    const { sinkFn, lines } = capture();
    const w = new StructuredLogWriter({ maxBufferSize: 2, sinkFn });
    w.info('e1');
    w.info('e2');
    w.info('e3'); // drops e1, fires overflow
    w.info('e4'); // drops e2, overflow already reported once
    w.flushSync();
    const events = lines.map((l) => JSON.parse(l).event);
    // W_AUDIT_OVERFLOW line appears directly via sink, then drained buffer [e3, e4].
    expect(events).toContain(OVERFLOW_EVENT);
    expect(events).toContain('e3');
    expect(events).toContain('e4');
    // Back-pressure signal is emitted exactly once per window.
    expect(events.filter((e) => e === OVERFLOW_EVENT).length).toBe(1);
    expect(w.droppedTotal).toBe(2);
  });

  it('C48-M1e: shutdown hook flushes buffer synchronously on trigger', async () => {
    const { sinkFn, lines } = capture();
    const w = new StructuredLogWriter({ maxBufferSize: 1000, sinkFn });
    const registry = createShutdownHookRegistry();
    registerStructuredLogShutdown(registry, w);
    for (let i = 0; i < 1000; i++) w.info(`e${i}`);
    await registry.trigger('SIGTERM');
    expect(lines.length).toBe(1000);
    expect(w.bufferSize).toBe(0);
  });

  it('C48-M1d: resetOverflowReported re-arms the signal', () => {
    const { sinkFn, lines } = capture();
    const w = new StructuredLogWriter({ maxBufferSize: 1, sinkFn });
    w.info('e1');
    w.info('e2'); // first overflow
    w.info('e3'); // silenced
    w.flushSync();
    const first = lines.filter((l) => l.includes(OVERFLOW_EVENT)).length;
    expect(first).toBe(1);
    w.resetOverflowReported();
    w.info('e4');
    w.info('e5'); // second overflow
    w.flushSync();
    const second = lines.filter((l) => l.includes(OVERFLOW_EVENT)).length;
    expect(second).toBe(2);
  });
});
