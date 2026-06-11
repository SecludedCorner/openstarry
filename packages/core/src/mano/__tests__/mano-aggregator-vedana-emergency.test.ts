/**
 * VedanaEmergency wiring test (GAP-2026-06-11, T1b).
 *
 * createManoAggregator's param-4 vedanaFn had been passed `undefined` at both
 * agent-core construction sites since Plan28 R1, so the sustained-dukkha
 * thresholdBoost path never ran in a live system (and config.vedanaEmergency
 * was computed-but-unconsumed). This test drives the boost through the REAL
 * route() path: sustained dukkha raises the effective threshold for one
 * route (blocking an otherwise-passing arbiter), then cooldown restores it.
 */

import { describe, it, expect, vi } from "vitest";
import { createManoAggregator } from "../mano-aggregator.js";
import type { ChannelVedana, IGearArbiter, GearContext, GearEvaluation, EventBus, VedanaEmergencyConfig } from "@openstarry/sdk";
import { DEFAULT_MANO_AGGREGATOR_CONFIG } from "@openstarry/sdk";

function makeBus(): EventBus {
  return { on: vi.fn(() => () => {}), once: vi.fn(() => () => {}), onAny: vi.fn(() => () => {}), emit: vi.fn() };
}

function makeContext(): GearContext {
  return { input: "x", proposedToolCalls: [], actionHistory: [], agentConfig: { id: "t1b" } };
}

const arbiter: IGearArbiter = {
  id: "fast",
  priority: 10,
  // 0.7 > base 0.6 → normally accepted (gear 1)
  evaluate: (): GearEvaluation => ({ action: 1, confidence: 0.7 }),
};

const EMERGENCY: VedanaEmergencyConfig = {
  intensityThreshold: 0.8,
  sustainedTicks: 3,
  maxThresholdBoost: 0.3, // 0.6 + 0.3 = 0.9 > 0.7 → blocks the same arbiter
  cooldownTicks: 2,
};

function vedanaOf(type: ChannelVedana["type"], intensity: number): ChannelVedana {
  return { valence: type === "dukkha" ? -0.9 : 0, intensity, type, source: "test" };
}

describe("ManoAggregator × VedanaEmergency (GAP-2026-06-11 T1b)", () => {
  it("sustained dukkha boosts the threshold for one route, blocking an otherwise-passing arbiter", async () => {
    let current: ChannelVedana = vedanaOf("upekkha", 0);
    const aggregator = createManoAggregator(
      makeBus(), DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, () => current, EMERGENCY,
    );

    // Calm: 0.7 > 0.6 → gear 1
    expect((await aggregator.route(makeContext(), [arbiter])).gear).toBe(1);

    // Sustained suffering: ticks 1 and 2 accumulate (no boost yet)…
    current = vedanaOf("dukkha", 0.9);
    expect((await aggregator.route(makeContext(), [arbiter])).gear).toBe(1);
    expect((await aggregator.route(makeContext(), [arbiter])).gear).toBe(1);

    // …tick 3 trips the emergency: θ = 0.6 + 0.3 = 0.9 → 0.7 blocked → default gear.
    expect((await aggregator.route(makeContext(), [arbiter])).gear).toBe(2);

    // Cooldown (2 ticks): boost off, fast path restored even under dukkha.
    expect((await aggregator.route(makeContext(), [arbiter])).gear).toBe(1);
    expect((await aggregator.route(makeContext(), [arbiter])).gear).toBe(1);
  });

  it("non-sustained dukkha (interrupted) never trips the boost", async () => {
    let current: ChannelVedana = vedanaOf("dukkha", 0.9);
    const aggregator = createManoAggregator(
      makeBus(), DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, () => current, EMERGENCY,
    );

    await aggregator.route(makeContext(), [arbiter]); // dukkha tick 1
    current = vedanaOf("upekkha", 0);                  // relief resets the counter
    await aggregator.route(makeContext(), [arbiter]);
    current = vedanaOf("dukkha", 0.9);                 // dukkha ticks 1-2 again — never reaches 3
    expect((await aggregator.route(makeContext(), [arbiter])).gear).toBe(1);
    expect((await aggregator.route(makeContext(), [arbiter])).gear).toBe(1);
  });

  it("low-intensity dukkha below the threshold does not count as sustained", async () => {
    const current = vedanaOf("dukkha", 0.5); // below intensityThreshold 0.8
    const aggregator = createManoAggregator(
      makeBus(), DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, () => current, EMERGENCY,
    );
    for (let i = 0; i < 6; i++) {
      expect((await aggregator.route(makeContext(), [arbiter])).gear).toBe(1);
    }
  });
});
