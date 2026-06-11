/**
 * Plan48 §9.3 L3 integration — cross-module cascade.
 *
 * Exercises:
 *   - structured-log writer + audit-sink subscription wired to a shared bus.
 *   - HMAC cleanup binding registered on the shared shutdown registry.
 *   - SIGTERM cascade order (structured-log 200 → audit-sink 300 → HMAC 400).
 *   - W_AUDIT_OVERFLOW warn emission on buffer saturation.
 *   - `capability_denied` + `ws_connection_denied` events persisted.
 *   - HMAC key cleared before the cascade completes.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  StructuredLogWriter,
  OVERFLOW_EVENT,
  registerStructuredLogShutdown,
} from '../../src/structured-log/index.js';
import {
  AuditBus,
  AuditSink,
} from '../../src/audit-sink/index.js';
import {
  captureHmacKey,
  registerHmacCleanupShutdown,
  HMAC_ENV_VAR_NAMES,
} from '../../src/hmac-cleanup/index.js';
import { createShutdownHookRegistry } from '../../src/audit-infra/shutdown-hooks.js';
import { createHmac } from 'node:crypto';

const TEST_KEY = 'c'.repeat(64);
const ts = '2026-04-25T00:00:00.000Z';

beforeEach(() => {
  for (const n of HMAC_ENV_VAR_NAMES) delete process.env[n];
});
afterEach(() => {
  for (const n of HMAC_ENV_VAR_NAMES) delete process.env[n];
});

function makeSink() {
  const lines: string[] = [];
  return { sinkFn: (l: string) => lines.push(l), lines };
}

describe('Plan48 L3 integration — C48-M1/M2/M3 end-to-end', () => {
  it('cascade: structured-log flush → audit-sink flush → HMAC sign + clear', async () => {
    process.env['OPENSTARRY_CHECKPOINT_HMAC_KEY'] = TEST_KEY;
    const registry = createShutdownHookRegistry();
    const bus = new AuditBus();
    const { sinkFn: logSink, lines: logLines } = makeSink();
    const { sinkFn: auditSink, lines: auditLines } = makeSink();

    const writer = new StructuredLogWriter({ maxBufferSize: 4, sinkFn: logSink });
    registerStructuredLogShutdown(registry, writer);

    const sink = new AuditSink({ bus, sinkFn: auditSink });
    sink.attach();
    sink.registerShutdown(registry);

    const binding = captureHmacKey();
    expect(binding).not.toBeNull();
    expect(process.env['OPENSTARRY_CHECKPOINT_HMAC_KEY']).toBeUndefined();

    let shutdownSignature: string | null = null;
    registerHmacCleanupShutdown(registry, {
      binding: binding!,
      onBeforeClear: (sign) => {
        shutdownSignature = sign('shutdown-artefact');
      },
    });

    // Step 2: emit capability_denied (C48-M2c)
    bus.publish({
      type: 'capability_denied',
      plugin: 'p-alpha',
      tool: 't-blocked',
      allowedTools: ['t-allowed'],
      timestamp: ts,
    });

    // Step 3: emit ws_connection_denied (C48-M2d)
    bus.publish({
      type: 'ws_connection_denied',
      reason: 'auth_failed',
      remote: '198.51.100.7',
      url: '/ws',
      timestamp: ts,
    });

    // Step 4: overflow structured-log ring (C48-M1d).
    for (let i = 0; i < 10; i++) writer.info(`e${i}`);

    // Step 5: cascade
    const t0 = Date.now();
    await registry.trigger('SIGTERM');
    const elapsed = Date.now() - t0;

    // Structured-log: overflow warn present, buffer drained, under 3s.
    expect(logLines.some((l) => l.includes(OVERFLOW_EVENT))).toBe(true);
    expect(writer.bufferSize).toBe(0);
    expect(elapsed).toBeLessThan(3000);

    // Audit-sink: both event types captured.
    const auditTypes = auditLines.map((l) => JSON.parse(l).type);
    expect(auditTypes).toContain('capability_denied');
    expect(auditTypes).toContain('ws_connection_denied');

    // HMAC: final signing artefact is valid, key cleared post-cascade.
    const expected = createHmac('sha256', TEST_KEY)
      .update('shutdown-artefact', 'utf-8')
      .digest('hex');
    expect(shutdownSignature).toBe(expected);
    expect(binding!.cleared).toBe(true);
    expect(() => binding!.sign('too-late')).toThrow();
  });

  it('C48-M1e zero-entries-lost: 1000 events queued → all flushed on SIGTERM', async () => {
    const registry = createShutdownHookRegistry();
    const { sinkFn, lines } = makeSink();
    const writer = new StructuredLogWriter({ maxBufferSize: 2000, sinkFn });
    registerStructuredLogShutdown(registry, writer);
    for (let i = 0; i < 1000; i++) writer.info(`event-${i}`, { i });
    await registry.trigger('SIGTERM');
    expect(lines.length).toBe(1000);
    const parsed = JSON.parse(lines[500]);
    expect(parsed.event).toBe('event-500');
  });

  it('C48-M2g shared shutdown order: audit-sink flushes AFTER structured-log', async () => {
    const registry = createShutdownHookRegistry();
    const order: string[] = [];
    const writer = new StructuredLogWriter({
      sinkFn: (_line) => order.push('log-flush'),
      maxBufferSize: 10,
    });
    writer.info('sentinel');
    registerStructuredLogShutdown(registry, writer);

    const bus = new AuditBus();
    const sink = new AuditSink({
      bus,
      sinkFn: (_line) => order.push('audit-flush'),
    });
    sink.attach();
    sink.registerShutdown(registry);
    bus.publish({
      type: 'capability_denied',
      plugin: 'p',
      tool: 't',
      allowedTools: [],
      timestamp: ts,
    });

    await registry.trigger('SIGTERM');
    // First occurrence of each must follow the expected order.
    const firstLog = order.indexOf('log-flush');
    const firstAudit = order.indexOf('audit-flush');
    expect(firstLog).toBeGreaterThanOrEqual(0);
    expect(firstAudit).toBeGreaterThanOrEqual(0);
    expect(firstLog).toBeLessThan(firstAudit);
  });
});
