/**
 * Tests for ManoAggregator pure router (N-Gear generalized).
 * @see mano/mano-aggregator.ts
 */
import { describe, it, expect, vi } from "vitest";
import { createManoAggregator } from "../mano-aggregator.js";
import type { IGearArbiter, GearContext, GearEvaluation, GearAction, EventBus, RiskCategory } from "@openstarry/sdk";
import { DEFAULT_MANO_AGGREGATOR_CONFIG } from "@openstarry/sdk";

function makeBus(): EventBus {
  return {
    on: vi.fn(() => () => {}),
    once: vi.fn(() => () => {}),
    onAny: vi.fn(() => () => {}),
    emit: vi.fn(),
  };
}

function makeContext(overrides: Partial<GearContext> = {}): GearContext {
  return {
    input: "hello",
    proposedToolCalls: [],
    actionHistory: [],
    agentConfig: { id: "test-agent" },
    ...overrides,
  };
}

function makeArbiter(
  id: string,
  priority: number,
  action: GearAction,
  confidence: number,
  riskCategory?: RiskCategory,
): IGearArbiter {
  return {
    id,
    priority,
    evaluate: (): GearEvaluation => ({ action, confidence, riskCategory }),
  };
}

describe("ManoAggregator", () => {
  it("G-1 path: returns defaultGear when no arbiters", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus);
    const result = await aggregator.route(makeContext(), []);
    expect(result.gear).toBe(2); // defaultGear = 2
    expect(result.confidence).toBe(0);
    expect(result.riskAdjusted).toBe(false);
  });

  it("returns defaultGear when all arbiters abstain", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus);
    const arbiters = [
      makeArbiter("a1", 10, "abstain", 0),
      makeArbiter("a2", 20, "abstain", 0),
    ];
    const result = await aggregator.route(makeContext(), arbiters);
    expect(result.gear).toBe(2);
    expect(result.riskAdjusted).toBe(false);
  });

  it("selects gear 1 when arbiter confidence exceeds base threshold", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus);
    const arbiters = [makeArbiter("fast", 10, 1, 0.8)];
    const result = await aggregator.route(makeContext(), arbiters);
    expect(result.gear).toBe(1);
    expect(result.decidedBy).toBe("fast");
    expect(result.riskAdjusted).toBe(false);
  });

  it("caps gear 1 confidence via maxConfidenceByGear", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus, {
      ...DEFAULT_MANO_AGGREGATOR_CONFIG,
      maxConfidenceByGear: { 1: 0.85 },
    });
    const arbiters = [makeArbiter("fast", 10, 1, 0.99)];
    const result = await aggregator.route(makeContext(), arbiters);
    expect(result.gear).toBe(1);
    expect(result.confidence).toBe(0.85);
  });

  it("applies risk-weighted threshold when arbiter declares riskCategory", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus);
    // 'destructive' → threshold = 0.6 + 0.20 = 0.80, confidence 0.7 < 0.8
    const arbiters = [makeArbiter("fast", 10, 1, 0.7, "destructive")];
    const result = await aggregator.route(makeContext(), arbiters);
    expect(result.gear).toBe(2); // falls back to defaultGear
  });

  it("risk-adjusted flag is true when arbiter provides riskCategory", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus);
    const arbiters = [makeArbiter("fast", 10, 1, 0.8, "informational")];
    const result = await aggregator.route(makeContext(), arbiters);
    expect(result.gear).toBe(1);
    expect(result.riskAdjusted).toBe(true);
  });

  it("handles per-arbiter timeout gracefully", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus, {
      ...DEFAULT_MANO_AGGREGATOR_CONFIG,
      perArbiterMs: 10,
      chainMs: 5000,
    });
    const slowArbiter: IGearArbiter = {
      id: "slow",
      priority: 10,
      evaluate: () => new Promise((resolve) =>
        setTimeout(() => resolve({ action: 1, confidence: 0.9 }), 500)
      ),
    };
    const fastArbiter = makeArbiter("fast", 20, 1, 0.9);
    const result = await aggregator.route(makeContext(), [slowArbiter, fastArbiter]);
    expect(result.gear).toBe(1);
    expect(result.decidedBy).toBe("fast");
  });

  it("emits gear:arbiter_evaluated events", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus);
    const arbiters = [makeArbiter("a1", 10, 1, 0.9)];
    await aggregator.route(makeContext(), arbiters);
    const emitCalls = (bus.emit as ReturnType<typeof vi.fn>).mock.calls;
    const evalEvents = emitCalls.filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "gear:arbiter_evaluated"
    );
    expect(evalEvents.length).toBeGreaterThanOrEqual(1);
  });

  // N-Gear tests
  it("supports gear 3 (future: deep reasoning)", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus);
    const arbiters = [makeArbiter("deep", 10, 3, 0.9)];
    const result = await aggregator.route(makeContext(), arbiters);
    expect(result.gear).toBe(3);
    expect(result.decidedBy).toBe("deep");
  });

  it("applies per-gear confidence cap for gear 3", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus, {
      ...DEFAULT_MANO_AGGREGATOR_CONFIG,
      maxConfidenceByGear: { 1: 0.95, 3: 0.80 },
    });
    const arbiters = [makeArbiter("deep", 10, 3, 0.99)];
    const result = await aggregator.route(makeContext(), arbiters);
    expect(result.gear).toBe(3);
    expect(result.confidence).toBe(0.80);
  });

  it("no cap for gears not listed in maxConfidenceByGear", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus, {
      ...DEFAULT_MANO_AGGREGATOR_CONFIG,
      maxConfidenceByGear: { 1: 0.95 }, // no cap for gear 4
    });
    const arbiters = [makeArbiter("experimental", 10, 4, 0.99)];
    const result = await aggregator.route(makeContext(), arbiters);
    expect(result.gear).toBe(4);
    expect(result.confidence).toBe(0.99); // no cap applied
  });

  it("rejects arbiter when confidence equals threshold exactly (strict >)", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus, {
      ...DEFAULT_MANO_AGGREGATOR_CONFIG,
      baseThreshold: 0.7,
    });
    // confidence 0.7 === threshold 0.7 → should NOT pass (strict >)
    const arbiters = [makeArbiter("exact", 10, 1, 0.7)];
    const result = await aggregator.route(makeContext(), arbiters);
    expect(result.gear).toBe(2); // falls back to defaultGear
  });

  it("emits gear:switch on no-winner fallback", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus);
    // confidence 0.3 < threshold 0.6 → no winner
    const arbiters = [makeArbiter("weak", 10, 1, 0.3)];
    await aggregator.route(makeContext(), arbiters);
    const emitCalls = (bus.emit as ReturnType<typeof vi.fn>).mock.calls;
    const switchEvents = emitCalls.filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "gear:switch"
    );
    expect(switchEvents.length).toBe(1);
    expect((switchEvents[0][0] as { payload: { gear: number } }).payload.gear).toBe(2);
  });

  it("emits gear:switch on all-abstain fallback", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus);
    const arbiters = [
      makeArbiter("a1", 10, "abstain", 0),
      makeArbiter("a2", 20, "abstain", 0),
    ];
    await aggregator.route(makeContext(), arbiters);
    const emitCalls = (bus.emit as ReturnType<typeof vi.fn>).mock.calls;
    const switchEvents = emitCalls.filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "gear:switch"
    );
    expect(switchEvents.length).toBe(1);
    expect((switchEvents[0][0] as { payload: { gear: number } }).payload.gear).toBe(2);
  });

  it("respects custom defaultGear", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus, {
      ...DEFAULT_MANO_AGGREGATOR_CONFIG,
      defaultGear: 3,
    });
    const result = await aggregator.route(makeContext(), []);
    expect(result.gear).toBe(3);
  });

  it("forceNextGear: route() returns forced gear, clears flag after one use", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus);

    aggregator.forceNextGear(1);

    // First call: must return forced gear 1
    const first = await aggregator.route(makeContext(), []);
    expect(first.gear).toBe(1);
    expect(first.confidence).toBe(1);

    // Second call: flag cleared, falls back to defaultGear (2)
    const second = await aggregator.route(makeContext(), []);
    expect(second.gear).toBe(2);
  });

  it("forceNextGear: emits gear:switch with reason 'vitakka_stall_override'", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus);

    aggregator.forceNextGear(1);
    await aggregator.route(makeContext(), []);

    const emitCalls = (bus.emit as ReturnType<typeof vi.fn>).mock.calls;
    const switchEvents = emitCalls.filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "gear:switch"
    );
    expect(switchEvents.length).toBeGreaterThanOrEqual(1);
    const switchEvent = switchEvents[0][0] as { payload: { reason: string; gear: number } };
    expect(switchEvent.payload.reason).toBe("vitakka_stall_override");
    expect(switchEvent.payload.gear).toBe(1);
  });

  it("baseThresholdFn: route() uses dynamic threshold from callback", async () => {
    const bus = makeBus();

    // Callback returns a high threshold (0.95), so confidence 0.8 should NOT pass
    const baseThresholdFn = vi.fn(() => 0.95);
    const aggregator = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, baseThresholdFn);

    const arbiters = [makeArbiter("arb", 10, 1, 0.8)];
    const result = await aggregator.route(makeContext(), arbiters);

    expect(baseThresholdFn).toHaveBeenCalled();
    // 0.8 <= 0.95 → should fall back to defaultGear
    expect(result.gear).toBe(2);
  });

  it("baseThresholdFn: undefined → falls back to config.baseThreshold", async () => {
    const bus = makeBus();

    // No callback — uses config.baseThreshold (0.6)
    const aggregator = createManoAggregator(bus, {
      ...DEFAULT_MANO_AGGREGATOR_CONFIG,
      baseThreshold: 0.6,
    });

    // confidence 0.7 > 0.6 → should select gear 1
    const arbiters = [makeArbiter("arb", 10, 1, 0.7)];
    const result = await aggregator.route(makeContext(), arbiters);
    expect(result.gear).toBe(1);
    expect(result.decidedBy).toBe("arb");
  });
});
