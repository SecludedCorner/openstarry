/**
 * Tests for AuditTrailWriter — JSONL writer for confidence audit events.
 * @see observability/audit-trail-writer.ts
 * @see Plan31 Wave 3
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAuditTrailWriter } from "../audit-trail-writer.js";
import type { EventBus, AgentEvent, AuditTrailConfig } from "@openstarry/sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

function makeBus(): EventBus & { emitAudit: (payload: Record<string, unknown>) => void } {
  const handlers: Array<{ type: string; handler: (event: AgentEvent) => void }> = [];
  const bus = {
    emit: vi.fn(),
    on: vi.fn((type: string, handler: (event: AgentEvent) => void) => {
      handlers.push({ type, handler });
      return () => {
        const idx = handlers.findIndex(h => h.handler === handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    }),
    once: vi.fn(),
    onAny: vi.fn(),
    emitAudit(payload: Record<string, unknown>) {
      const event: AgentEvent = {
        type: 'audit:completed',
        timestamp: Date.now(),
        payload,
      };
      for (const h of handlers) {
        if (h.type === 'audit:completed') h.handler(event);
      }
    },
  };
  return bus as unknown as EventBus & { emitAudit: (payload: Record<string, unknown>) => void };
}

function makeAuditPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    inputConfidence: 0.80,
    rawDelta: -0.03,
    clampedDelta: -0.03,
    wasClamped: false,
    reasoning: 'test audit reasoning',
    outputConfidence: 0.77,
    result: 'adjusted',
    auditDurationMs: 5,
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-trail-test-'));
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

describe("AuditTrailWriter — basic write", () => {
  it("writes JSONL entry on audit:completed event", () => {
    const bus = makeBus();
    const filePath = path.join(tmpDir, 'audit.jsonl');
    const writer = createAuditTrailWriter(bus, 'test-agent', { filePath });
    writer.start();

    bus.emitAudit(makeAuditPayload());

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.agentId).toBe('test-agent');
    expect(entry.version).toBe(1);
    expect(entry.inputConfidence).toBe(0.80);
    expect(entry.clampedDelta).toBe(-0.03);
    expect(entry.result).toBe('adjusted');
  });

  it("appends multiple entries", () => {
    const bus = makeBus();
    const filePath = path.join(tmpDir, 'audit.jsonl');
    const writer = createAuditTrailWriter(bus, 'test-agent', { filePath });
    writer.start();

    bus.emitAudit(makeAuditPayload({ inputConfidence: 0.80 }));
    bus.emitAudit(makeAuditPayload({ inputConfidence: 0.70 }));
    bus.emitAudit(makeAuditPayload({ inputConfidence: 0.60 }));

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).inputConfidence).toBe(0.80);
    expect(JSON.parse(lines[2]).inputConfidence).toBe(0.60);
  });
});

describe("AuditTrailWriter — rotation", () => {
  it("rotates when maxSizeBytes exceeded", () => {
    const bus = makeBus();
    const filePath = path.join(tmpDir, 'audit.jsonl');
    // Very small size to trigger rotation
    const config: AuditTrailConfig = { filePath, maxSizeBytes: 100, maxFiles: 3 };
    const writer = createAuditTrailWriter(bus, 'test-agent', config);
    writer.start();

    // Write enough entries to exceed 100 bytes
    for (let i = 0; i < 5; i++) {
      bus.emitAudit(makeAuditPayload({ inputConfidence: i * 0.1 }));
    }

    // Rotated file should exist
    expect(fs.existsSync(`${filePath}.1`)).toBe(true);
    // Current file should be small
    const currentSize = fs.statSync(filePath).size;
    expect(currentSize).toBeLessThan(500);
  });
});

describe("AuditTrailWriter — stop", () => {
  it("stop() unsubscribes from events", async () => {
    const bus = makeBus();
    const filePath = path.join(tmpDir, 'audit.jsonl');
    const writer = createAuditTrailWriter(bus, 'test-agent', { filePath });
    writer.start();

    bus.emitAudit(makeAuditPayload());
    await writer.stop();
    bus.emitAudit(makeAuditPayload({ inputConfidence: 0.99 }));

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    // Only 1 entry, not 2 (second was after stop)
    expect(lines).toHaveLength(1);
  });
});

describe("AuditTrailWriter — Wave 5 fields (ISSUE-5)", () => {
  it("includes riskCategory, thresholdAtDecision, gearAtDecision, decidedBy when present", () => {
    const bus = makeBus();
    const filePath = path.join(tmpDir, 'audit.jsonl');
    const writer = createAuditTrailWriter(bus, 'test-agent', { filePath });
    writer.start();

    bus.emitAudit(makeAuditPayload({
      riskCategory: 'read_only',
      thresholdAtDecision: 0.65,
      gearAtDecision: 1,
      decidedBy: 'static-rule-arbiter',
    }));

    const content = fs.readFileSync(filePath, 'utf8');
    const entry = JSON.parse(content.trim());
    expect(entry.riskCategory).toBe('read_only');
    expect(entry.thresholdAtDecision).toBe(0.65);
    expect(entry.gearAtDecision).toBe(1);
    expect(entry.decidedBy).toBe('static-rule-arbiter');
  });

  it("omits Wave 5 fields when not present (backward compat)", () => {
    const bus = makeBus();
    const filePath = path.join(tmpDir, 'audit.jsonl');
    const writer = createAuditTrailWriter(bus, 'test-agent', { filePath });
    writer.start();

    bus.emitAudit(makeAuditPayload());

    const content = fs.readFileSync(filePath, 'utf8');
    const entry = JSON.parse(content.trim());
    expect(entry.riskCategory).toBeUndefined();
    expect(entry.thresholdAtDecision).toBeUndefined();
    expect(entry.gearAtDecision).toBeUndefined();
    expect(entry.decidedBy).toBeUndefined();
  });
});

describe("AuditTrailWriter — type discriminant field (FINDING-2 fix)", () => {
  it("audit:completed entries have type: 'confidence_audited'", () => {
    const bus = makeBus();
    const filePath = path.join(tmpDir, 'audit.jsonl');
    const writer = createAuditTrailWriter(bus, 'test-agent', { filePath });
    writer.start();

    bus.emitAudit(makeAuditPayload());

    const content = fs.readFileSync(filePath, 'utf8');
    const entry = JSON.parse(content.trim());
    expect(entry.type).toBe('confidence_audited');
  });

  it("audit:tool_audited entries have type: 'tool_audited'", () => {
    const handlers: Array<{ type: string; handler: (event: any) => void }> = [];
    const bus2 = {
      emit: vi.fn(),
      on: vi.fn((type: string, handler: (event: any) => void) => {
        handlers.push({ type, handler });
        return () => {};
      }),
      once: vi.fn(),
      onAny: vi.fn(),
    } as unknown as EventBus;

    const filePath = path.join(tmpDir, 'audit-tool.jsonl');
    const writer = createAuditTrailWriter(bus2, 'test-agent', { filePath });
    writer.start();

    const toolEvent = {
      type: 'audit:tool_audited',
      timestamp: Date.now(),
      payload: {
        toolName: 'bash',
        inferredRiskCategory: 'destructive',
        executionResult: 'success',
        batchIndex: 0,
        batchSize: 1,
        rawDelta: -0.05,
        clampedDelta: -0.05,
        decidedBy: 'static-rule-arbiter',
        timestamp: Date.now(),
      },
    };
    for (const h of handlers) {
      if (h.type === 'audit:tool_audited') h.handler(toolEvent as any);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const entry = JSON.parse(content.trim());
    expect(entry.type).toBe('tool_audited');
  });
});

describe("AuditTrailWriter — restart", () => {
  it("resumes writing after stop + start", async () => {
    const bus = makeBus();
    const filePath = path.join(tmpDir, 'audit.jsonl');
    const writer = createAuditTrailWriter(bus, 'test-agent', { filePath });

    writer.start();
    bus.emitAudit(makeAuditPayload({ inputConfidence: 0.80 }));
    await writer.stop();

    // Re-create writer (simulates restart)
    const writer2 = createAuditTrailWriter(bus, 'test-agent', { filePath });
    writer2.start();
    bus.emitAudit(makeAuditPayload({ inputConfidence: 0.90 }));
    await writer2.stop();

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).inputConfidence).toBe(0.90);
  });
});
