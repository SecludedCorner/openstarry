/**
 * Tests for ManoAggregator Layer 2 confidence audit (Plan29).
 * @see mano/mano-aggregator.ts
 */
import { describe, it, expect, vi } from "vitest";
import { createManoAggregator } from "../mano-aggregator.js";
import type { EventBus, IGearArbiter, GearContext, IConfidenceAuditor, ManoAggregatorConfig } from "@openstarry/sdk";
import { DEFAULT_MANO_AGGREGATOR_CONFIG } from "@openstarry/sdk";

function makeBus(): EventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(() => () => {}),
    off: vi.fn(),
  } as unknown as EventBus;
}

function makeContext(): GearContext {
  return {
    input: "test",
    proposedToolCalls: [{ name: "read_file", arguments: {} }],
    actionHistory: [],
    agentConfig: { id: "test-agent" },
  };
}

function makeArbiter(id: string, gear: number, confidence: number): IGearArbiter {
  return {
    id,
    priority: 10,
    evaluate: () => ({
      action: gear,
      confidence,
      riskCategory: 'informational' as const,
    }),
  };
}

function makeAuditor(delta: number): IConfidenceAuditor {
  return {
    skandha: 'vijnana',
    id: 'test-auditor',
    audit: vi.fn(() => ({ delta, reasoning: 'test audit' })),
  };
}

describe("ManoAggregator — Layer 2 Confidence Audit (Plan29)", () => {
  it("auditor adjusts confidence upward", async () => {
    const bus = makeBus();
    const auditor = makeAuditor(0.03);
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, auditor);
    const arbiter = makeArbiter("a1", 1, 0.80);

    const result = await agg.route(makeContext(), [arbiter]);
    expect(result.gear).toBe(1);
    // 0.80 capped at 0.95, then +0.03 audit = 0.98 — but cap is applied first, then audit
    // Actually: confidence 0.80, cap for gear 1 = 0.95 → effectiveConfidence = 0.80 (not capped)
    // Then auditDelta 0.03 → auditedConfidence = 0.83
    expect(result.confidence).toBeCloseTo(0.83, 2);
    expect(auditor.audit).toHaveBeenCalled();
  });

  it("auditor adjusts confidence downward", async () => {
    const bus = makeBus();
    const auditor = makeAuditor(-0.04);
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, auditor);
    const arbiter = makeArbiter("a1", 1, 0.85);

    const result = await agg.route(makeContext(), [arbiter]);
    expect(result.confidence).toBeCloseTo(0.81, 2);
  });

  it("audit delta is clamped to ±0.05", async () => {
    const bus = makeBus();
    const auditor = makeAuditor(0.50); // way over MAX_AUDIT_DELTA
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, auditor);
    const arbiter = makeArbiter("a1", 1, 0.80);

    const result = await agg.route(makeContext(), [arbiter]);
    expect(result.confidence).toBeCloseTo(0.85, 2); // 0.80 + 0.05 (clamped)
  });

  it("auditor timeout → delta=0 (fail-safe)", async () => {
    const bus = makeBus();
    const slowAuditor: IConfidenceAuditor = {
      skandha: 'vijnana',
      id: 'slow-auditor',
      audit: () => new Promise(resolve => setTimeout(() => resolve({ delta: 0.05, reasoning: 'late' }), 500)),
    };
    const config: ManoAggregatorConfig = { ...DEFAULT_MANO_AGGREGATOR_CONFIG, auditTimeoutMs: 10 };
    const agg = createManoAggregator(bus, config, undefined, undefined, undefined, slowAuditor);
    const arbiter = makeArbiter("a1", 1, 0.80);

    const result = await agg.route(makeContext(), [arbiter]);
    // Timeout → delta=0, confidence unchanged
    expect(result.confidence).toBeCloseTo(0.80, 2);
  });

  it("auditor error → delta=0 (fail-safe)", async () => {
    const bus = makeBus();
    const errorAuditor: IConfidenceAuditor = {
      skandha: 'vijnana',
      id: 'error-auditor',
      audit: () => { throw new Error("audit failed"); },
    };
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, errorAuditor);
    const arbiter = makeArbiter("a1", 1, 0.80);

    const result = await agg.route(makeContext(), [arbiter]);
    expect(result.confidence).toBeCloseTo(0.80, 2);
  });

  it("no auditor → confidence unchanged (backward compat)", async () => {
    const bus = makeBus();
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG);
    const arbiter = makeArbiter("a1", 1, 0.80);

    const result = await agg.route(makeContext(), [arbiter]);
    expect(result.confidence).toBeCloseTo(0.80, 2);
  });
});
