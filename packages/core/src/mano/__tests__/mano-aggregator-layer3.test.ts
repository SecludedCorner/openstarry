/**
 * Tests for ManoAggregator Layer 3: Loop Quality threshold adjustment.
 * @see mano/mano-aggregator.ts — Plan30 Wave 2
 */
import { describe, it, expect, vi } from "vitest";
import { createManoAggregator } from "../mano-aggregator.js";
import type { IGearArbiter, GearContext, GearEvaluation, GearAction, EventBus } from "@openstarry/sdk";
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
): IGearArbiter {
  return {
    id,
    priority,
    evaluate: (): GearEvaluation => ({ action, confidence }),
  };
}

describe("ManoAggregator Layer 3 (Loop Quality)", () => {
  it("L3 no-op when loopQualityFn absent: threshold unchanged (backward compatible)", async () => {
    const bus = makeBus();
    // No loopQualityFn → Layer 3 inactive
    // baseThreshold=0.6, confidence=0.65 — should pass
    const aggregator = createManoAggregator(bus, {
      ...DEFAULT_MANO_AGGREGATOR_CONFIG,
      baseThreshold: 0.6,
    });
    const arbiters = [makeArbiter("arb", 10, 1, 0.65)];
    const result = await aggregator.route(makeContext(), arbiters);
    expect(result.gear).toBe(1);
    expect(result.decidedBy).toBe("arb");
  });

  it("L3 no-op when q=0: threshold unchanged", async () => {
    const bus = makeBus();
    // loopQualityFn returns 0 → alpha * q = 0 → no adjustment
    const loopQualityFn = vi.fn(() => 0);
    const aggregator = createManoAggregator(
      bus,
      { ...DEFAULT_MANO_AGGREGATOR_CONFIG, baseThreshold: 0.6 },
      undefined,
      undefined,
      undefined,
      undefined,
      loopQualityFn,
    );
    // confidence 0.65 > threshold 0.6 — should still pass (q=0 means no reduction)
    const arbiters = [makeArbiter("arb", 10, 1, 0.65)];
    const result = await aggregator.route(makeContext(), arbiters);
    expect(result.gear).toBe(1);
  });

  it("L3 reduces threshold at q=1: arbiter that was below threshold now passes", async () => {
    const bus = makeBus();
    // baseThreshold=0.6, alpha=0.10 (default), q=1
    // effective threshold = max(floor, 0.6 * (1 - 0.10 * 1)) = max(0.3, 0.54) = 0.54
    // confidence=0.58 > 0.54 → should now pass
    const loopQualityFn = vi.fn(() => 1);
    const aggregator = createManoAggregator(
      bus,
      { ...DEFAULT_MANO_AGGREGATOR_CONFIG, baseThreshold: 0.6 },
      undefined,
      undefined,
      undefined,
      undefined,
      loopQualityFn,
    );
    // Verify without L3: confidence=0.58 < 0.6 → would fall to defaultGear
    const busNoL3 = makeBus();
    const aggregatorNoL3 = createManoAggregator(busNoL3, {
      ...DEFAULT_MANO_AGGREGATOR_CONFIG,
      baseThreshold: 0.6,
    });
    const resultNoL3 = await aggregatorNoL3.route(makeContext(), [makeArbiter("arb", 10, 1, 0.58)]);
    expect(resultNoL3.gear).toBe(2); // Confirm it fails without L3

    // With L3: should pass
    const result = await aggregator.route(makeContext(), [makeArbiter("arb", 10, 1, 0.58)]);
    expect(result.gear).toBe(1);
    expect(result.decidedBy).toBe("arb");
  });

  it("L3 threshold floor respected: q=1 cannot push threshold below thresholdFloor", async () => {
    const bus = makeBus();
    // thresholdFloor=0.3, baseThreshold=0.31, alpha=0.10, q=1
    // raw adjusted = 0.31 * (1 - 0.10) = 0.279 < floor 0.3 → clipped to 0.3
    // confidence=0.25 < 0.3 → should NOT pass
    const loopQualityFn = vi.fn(() => 1);
    const aggregator = createManoAggregator(
      bus,
      { ...DEFAULT_MANO_AGGREGATOR_CONFIG, baseThreshold: 0.31, thresholdFloor: 0.3 },
      undefined,
      undefined,
      undefined,
      undefined,
      loopQualityFn,
    );
    const arbiters = [makeArbiter("arb", 10, 1, 0.25)];
    const result = await aggregator.route(makeContext(), arbiters);
    expect(result.gear).toBe(2); // falls to defaultGear
  });

  it("q clamped to [0,1]: loopQualityFn returning 1.5 treated as 1.0", async () => {
    const bus = makeBus();
    // q=1.5 clamped to 1.0 → same as q=1 test
    // threshold = max(floor, 0.6 * 0.9) = 0.54
    const loopQualityFnHigh = vi.fn(() => 1.5);
    const loopQualityFnClamped = vi.fn(() => 1.0);

    const aggHigh = createManoAggregator(
      bus,
      { ...DEFAULT_MANO_AGGREGATOR_CONFIG, baseThreshold: 0.6 },
      undefined,
      undefined,
      undefined,
      undefined,
      loopQualityFnHigh,
    );
    const aggClamped = createManoAggregator(
      makeBus(),
      { ...DEFAULT_MANO_AGGREGATOR_CONFIG, baseThreshold: 0.6 },
      undefined,
      undefined,
      undefined,
      undefined,
      loopQualityFnClamped,
    );

    const arb = [makeArbiter("arb", 10, 1, 0.58)];
    const [r1, r2] = await Promise.all([
      aggHigh.route(makeContext(), arb),
      aggClamped.route(makeContext(), arb),
    ]);
    // Both should behave identically (q=1.5 clamped to 1.0)
    expect(r1.gear).toBe(r2.gear);
    expect(r1.gear).toBe(1);
  });

  it("q clamped negative: loopQualityFn returning -0.2 treated as 0 (no-op)", async () => {
    const bus = makeBus();
    // q=-0.2 clamped to 0 → no reduction → threshold stays at 0.6
    // confidence=0.58 < 0.6 → should NOT pass
    const loopQualityFn = vi.fn(() => -0.2);
    const aggregator = createManoAggregator(
      bus,
      { ...DEFAULT_MANO_AGGREGATOR_CONFIG, baseThreshold: 0.6 },
      undefined,
      undefined,
      undefined,
      undefined,
      loopQualityFn,
    );
    const arbiters = [makeArbiter("arb", 10, 1, 0.58)];
    const result = await aggregator.route(makeContext(), arbiters);
    expect(result.gear).toBe(2); // no reduction → still falls short
  });

  it("custom alpha=0: L3 completely disabled", async () => {
    const bus = makeBus();
    // alpha=0 → alpha > 0 check fails → no threshold adjustment
    const loopQualityFn = vi.fn(() => 1);
    const aggregator = createManoAggregator(
      bus,
      { ...DEFAULT_MANO_AGGREGATOR_CONFIG, baseThreshold: 0.6, loopQualityAlpha: 0 },
      undefined,
      undefined,
      undefined,
      undefined,
      loopQualityFn,
    );
    // confidence 0.58 < 0.6 → should fail (L3 disabled by alpha=0)
    const arbiters = [makeArbiter("arb", 10, 1, 0.58)];
    const result = await aggregator.route(makeContext(), arbiters);
    expect(result.gear).toBe(2);
  });
});
