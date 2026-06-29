/**
 * C48-M2a / M2c / M2d / M2e / M2f / M2g unit tests.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  AuditBus,
  AuditSink,
  AUDIT_OVERFLOW_EVENT,
} from '../../src/audit-sink/index.js';
import { createShutdownHookRegistry } from '../../src/audit-infra/shutdown-hooks.js';

function capture(): { sinkFn: (l: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { sinkFn: (l) => lines.push(l), lines };
}

const ts = '2026-04-25T00:00:00.000Z';

beforeEach(() => {
  delete process.env['AUDIT_SINK_PATH'];
  delete process.env['AUDIT_SINK_BUFFER_MAX'];
  delete process.env['AUDIT_SINK_DEDUPE_WINDOW'];
});

afterEach(() => {
  delete process.env['AUDIT_SINK_PATH'];
  delete process.env['AUDIT_SINK_BUFFER_MAX'];
  delete process.env['AUDIT_SINK_DEDUPE_WINDOW'];
});

describe('AuditSink (C48-M2)', () => {
  it('C48-M2a: attach subscribes to all audit event types', () => {
    const bus = new AuditBus();
    const { sinkFn } = capture();
    const sink = new AuditSink({ bus, sinkFn });
    expect(bus.listenerCount('capability_denied')).toBe(0);
    sink.attach();
    expect(bus.listenerCount('capability_denied')).toBe(1);
    expect(bus.listenerCount('ws_connection_denied')).toBe(1);
    expect(bus.listenerCount('agent_request_denied')).toBe(1);
    sink.detach();
    expect(bus.listenerCount('capability_denied')).toBe(0);
    expect(bus.listenerCount('agent_request_denied')).toBe(0);
  });

  it('C48-M2c: capability_denied event is journaled', () => {
    const bus = new AuditBus();
    const { sinkFn, lines } = capture();
    const sink = new AuditSink({ bus, sinkFn });
    sink.attach();
    bus.publish({
      type: 'capability_denied',
      plugin: 'p1',
      tool: 't1',
      allowedTools: [],
      timestamp: ts,
    });
    sink.flushSync();
    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe('capability_denied');
    expect(parsed.plugin).toBe('p1');
    expect(parsed.tool).toBe('t1');
    expect(parsed.audit_key).toMatch(new RegExp(`^${ts}\\|`));
  });

  it('C48-M2d: ws_connection_denied event is journaled', () => {
    const bus = new AuditBus();
    const { sinkFn, lines } = capture();
    const sink = new AuditSink({ bus, sinkFn });
    sink.attach();
    bus.publish({
      type: 'ws_connection_denied',
      reason: 'origin_blocked',
      origin: 'https://evil.example',
      timestamp: ts,
    });
    sink.flushSync();
    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe('ws_connection_denied');
    expect(parsed.reason).toBe('origin_blocked');
  });

  it('⑦ agent_request_denied event is journaled (rate_limited + spawn_constraint)', () => {
    const bus = new AuditBus();
    const { sinkFn, lines } = capture();
    const sink = new AuditSink({ bus, sinkFn });
    sink.attach();
    bus.publish({
      type: 'agent_request_denied',
      reason: 'rate_limited',
      agentId: 'agent-1',
      detail: 'session:s1',
      timestamp: ts,
    });
    bus.publish({
      type: 'agent_request_denied',
      reason: 'spawn_constraint',
      agentId: 'agent-1',
      detail: 'CEILING_EXCEEDED',
      timestamp: ts,
    });
    sink.flushSync();
    expect(lines.length).toBe(2);
    const a = JSON.parse(lines[0]);
    const b = JSON.parse(lines[1]);
    expect(a.type).toBe('agent_request_denied');
    expect(a.reason).toBe('rate_limited');
    expect(a.agentId).toBe('agent-1');
    expect(b.reason).toBe('spawn_constraint');
    expect(b.detail).toBe('CEILING_EXCEEDED');
    // Distinct reason/detail ⇒ distinct dedupe keys ⇒ both journaled.
    expect(a.audit_key).not.toBe(b.audit_key);
  });

  it('⑦ agent_request_denied event is journaled (comm_denied, Fractal Society C/T1)', () => {
    const bus = new AuditBus();
    const { sinkFn, lines } = capture();
    const sink = new AuditSink({ bus, sinkFn });
    sink.attach();
    bus.publish({
      type: 'agent_request_denied',
      reason: 'comm_denied',
      agentId: 'agent-b',
      detail: 'HMAC:agent-evil',
      timestamp: ts,
    });
    bus.publish({
      type: 'agent_request_denied',
      reason: 'comm_denied',
      agentId: 'agent-b',
      detail: 'INBOUND:Receiver agent-b does not accept from agent-evil',
      timestamp: ts,
    });
    sink.flushSync();
    expect(lines.length).toBe(2);
    const a = JSON.parse(lines[0]);
    const b = JSON.parse(lines[1]);
    expect(a.type).toBe('agent_request_denied');
    expect(a.reason).toBe('comm_denied');
    expect(a.detail).toBe('HMAC:agent-evil');
    expect(b.reason).toBe('comm_denied');
    // Distinct detail ⇒ distinct dedupe keys ⇒ both journaled.
    expect(a.audit_key).not.toBe(b.audit_key);
  });

  it('⑦ identical agent_request_denied events are deduped', () => {
    const bus = new AuditBus();
    const { sinkFn, lines } = capture();
    const sink = new AuditSink({ bus, sinkFn });
    sink.attach();
    const event = {
      type: 'agent_request_denied' as const,
      reason: 'spawn_constraint' as const,
      agentId: 'agent-1',
      detail: 'DRAINING',
      timestamp: ts,
    };
    bus.publish(event);
    bus.publish(event);
    sink.flushSync();
    expect(lines.length).toBe(1);
    expect(sink.stats().duplicates).toBe(1);
  });

  it('C48-M2b: duplicate (timestamp + hash) events are deduped', () => {
    const bus = new AuditBus();
    const { sinkFn, lines } = capture();
    const sink = new AuditSink({ bus, sinkFn });
    sink.attach();
    const event = {
      type: 'capability_denied' as const,
      plugin: 'p1',
      tool: 't1',
      allowedTools: [],
      timestamp: ts,
    };
    bus.publish(event);
    bus.publish(event);
    bus.publish(event);
    sink.flushSync();
    expect(lines.length).toBe(1);
    expect(sink.stats().duplicates).toBe(2);
  });

  it('C48-M2e: AUDIT_SINK_PATH env override is honored', () => {
    process.env['AUDIT_SINK_PATH'] = '/tmp/custom-audit.jsonl';
    const bus = new AuditBus();
    const { sinkFn } = capture();
    const sink = new AuditSink({ bus, sinkFn });
    expect(sink.config.path).toBe('/tmp/custom-audit.jsonl');
  });

  it('C48-M2f: overflow emits W_AUDIT_OVERFLOW direct to sink', () => {
    const bus = new AuditBus();
    const { sinkFn, lines } = capture();
    const sink = new AuditSink({
      bus,
      sinkFn,
      config: { maxBufferSize: 2 },
    });
    sink.attach();
    // Distinct events (dedup-safe) to exercise buffer overflow.
    for (let i = 0; i < 5; i++) {
      bus.publish({
        type: 'capability_denied',
        plugin: 'p1',
        tool: `t${i}`,
        allowedTools: [],
        timestamp: new Date(1000 + i).toISOString(),
      });
    }
    sink.flushSync();
    expect(lines.some((l) => l.includes(AUDIT_OVERFLOW_EVENT))).toBe(true);
  });

  it('C48-M2g: registerShutdown flushes on trigger', async () => {
    const bus = new AuditBus();
    const { sinkFn, lines } = capture();
    const sink = new AuditSink({ bus, sinkFn });
    const registry = createShutdownHookRegistry();
    sink.attach();
    sink.registerShutdown(registry);
    bus.publish({
      type: 'capability_denied',
      plugin: 'p1',
      tool: 't1',
      allowedTools: [],
      timestamp: ts,
    });
    await registry.trigger('SIGTERM');
    expect(lines.length).toBe(1);
  });
});
