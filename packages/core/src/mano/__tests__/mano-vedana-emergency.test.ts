/**
 * Tests for ManoAggregator VedanaEmergency wiring (Plan28 R1).
 * - thresholdBoost raises effectiveBaseThreshold
 * - Cooldown period: boost = 0
 * - No vedanaFn: backward compat (no boost)
 */
import { describe, it, expect, vi } from "vitest";
import { createManoAggregator } from "../mano-aggregator.js";
import type { IGearArbiter, GearContext, GearEvaluation, GearAction, EventBus, ChannelVedana, VedanaEmergencyConfig } from "@openstarry/sdk";

function makeBus(): EventBus {
  return {
    on: vi.fn(() => () => {}),
    once: vi.fn(() => () => {}),
    onAny: vi.fn(() => () => {}),
    emit: vi.fn(),
  };
}

function makeContext(): GearContext {
  return {
    input: "hello",
    proposedToolCalls: [],
    actionHistory: [],
    agentConfig: { id: "test-agent" },
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

function makeDukkhaVedana(intensity = 0.9): ChannelVedana {
  return { valence: -0.8, intensity, type: "dukkha", source: "test" };
}

function makeNeutralVedana(): ChannelVedana {
  return { valence: 0, intensity: 0.1, type: "upekkha", source: "test" };
}

describe("ManoAggregator VedanaEmergency wiring (Plan28 R1)", () => {
  it("thresholdBoost raises effectiveBaseThreshold after sustained dukkha", async () => {
    const bus = makeBus();
    const config: VedanaEmergencyConfig = {
      intensityThreshold: 0.8,
      sustainedTicks: 3,
      maxThresholdBoost: 0.15,
      cooldownTicks: 2,
    };
    const vedanaFn = vi.fn(() => makeDukkhaVedana());
    const agg = createManoAggregator(bus, undefined, undefined, vedanaFn, config);

    // Arbiter with confidence 0.7 — default threshold 0.6 would pass normally
    const arbiter = makeArbiter("a1", 1, 1, 0.7);

    // First 2 route calls accumulate dukkha ticks but don't trigger yet
    await agg.route(makeContext(), [arbiter]); // tick 1
    await agg.route(makeContext(), [arbiter]); // tick 2

    // Third call triggers emergency: threshold becomes 0.6 + 0.15 = 0.75
    // Arbiter confidence 0.7 < 0.75, so it should NOT pass
    const result = await agg.route(makeContext(), [arbiter]); // tick 3 → trigger

    // The arbiter's 0.7 confidence should now fail against boosted threshold 0.75
    expect(result.gear).toBe(2); // default gear (arbiter failed threshold)
  });

  it("cooldown period: boost = 0", async () => {
    const bus = makeBus();
    const config: VedanaEmergencyConfig = {
      intensityThreshold: 0.8,
      sustainedTicks: 2,
      maxThresholdBoost: 0.15,
      cooldownTicks: 2,
    };
    const vedanaFn = vi.fn(() => makeDukkhaVedana());
    const agg = createManoAggregator(bus, undefined, undefined, vedanaFn, config);
    const arbiter = makeArbiter("a1", 1, 1, 0.7);

    // Trigger emergency (2 ticks)
    await agg.route(makeContext(), [arbiter]);
    await agg.route(makeContext(), [arbiter]); // trigger

    // Now in cooldown — vedanaFn still returns dukkha but boost should be 0
    vedanaFn.mockReturnValue(makeDukkhaVedana());
    const result = await agg.route(makeContext(), [arbiter]); // cooldown tick 1

    // Arbiter 0.7 > base 0.6 → should pass during cooldown (no boost)
    expect(result.gear).toBe(1);
  });

  it("no vedanaFn: backward compat (no boost)", async () => {
    const bus = makeBus();
    // No vedanaFn passed
    const agg = createManoAggregator(bus);
    const arbiter = makeArbiter("a1", 1, 1, 0.7);

    const result = await agg.route(makeContext(), [arbiter]);
    // 0.7 > 0.6 (default threshold) → passes
    expect(result.gear).toBe(1);
  });

  it("neutral vedana does not accumulate ticks", async () => {
    const bus = makeBus();
    const config: VedanaEmergencyConfig = {
      intensityThreshold: 0.8,
      sustainedTicks: 2,
      maxThresholdBoost: 0.15,
      cooldownTicks: 2,
    };
    const vedanaFn = vi.fn(() => makeNeutralVedana());
    const agg = createManoAggregator(bus, undefined, undefined, vedanaFn, config);
    const arbiter = makeArbiter("a1", 1, 1, 0.7);

    // Multiple calls with neutral vedana — should never boost
    for (let i = 0; i < 10; i++) {
      const result = await agg.route(makeContext(), [arbiter]);
      expect(result.gear).toBe(1); // 0.7 > 0.6, always passes
    }
  });
});
