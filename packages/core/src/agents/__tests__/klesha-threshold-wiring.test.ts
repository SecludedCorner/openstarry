/**
 * createKleshaThresholdFn wiring tests (TENET-2026-06-11 — Doc 37 closure).
 *
 * Before this wiring, KleshaModulatedDispatcher.computeThreshold had no
 * runtime caller: createManoAggregator's baseThresholdFn slot (the
 * purpose-built dynamic-θ hook) was passed `undefined` at both agent-core
 * construction sites, so θ(t) never reached a gear decision. These tests
 * cover the threshold-fn half; the end-to-end gear flip lives in
 * mano/__tests__/mano-aggregator-klesha.test.ts.
 */

import { describe, it, expect, vi } from "vitest";
import type { ChannelVedana, VedanaAssessment, KleshaModulationConfig, EventBus } from "@openstarry/sdk";
import { createKleshaSignalFn, createKleshaThresholdFn } from "../agent-core.js";
import { createDefaultKleshas, KleshaModulatedDispatcher } from "../../vijnana/klesha.js";

function assessmentOf(valence: number, intensity = 0.8): VedanaAssessment {
  const aggregate: ChannelVedana = {
    valence,
    intensity,
    type: valence > 0.3 ? "sukha" : valence < -0.3 ? "dukkha" : "upekkha",
    source: "test",
  };
  return { aggregate, channels: [aggregate], pidOutput: valence * intensity, timestamp: 1 };
}

function modConfig(overrides: Partial<KleshaModulationConfig> = {}): KleshaModulationConfig {
  return {
    baseThreshold: 0.6,
    minThreshold: 0.3,
    maxThreshold: 0.9,
    weights: { sneha: -0.15, mana: 0.15 },
    ...overrides,
  };
}

function makeRig(opts: {
  valenceFn: () => number;
  config?: KleshaModulationConfig;
  bus?: EventBus;
}): { thresholdFn: () => number; signalFn: ReturnType<typeof createKleshaSignalFn> } {
  const perceivers = createDefaultKleshas();
  const signalFn = createKleshaSignalFn(perceivers, () => assessmentOf(opts.valenceFn()), []);
  const dispatcher = new KleshaModulatedDispatcher([...perceivers], opts.config ?? modConfig());
  return { thresholdFn: createKleshaThresholdFn(dispatcher, signalFn, opts.bus), signalFn };
}

describe("createKleshaThresholdFn (TENET-2026-06-11)", () => {
  it("neutral input: θ stays within [min, max] and at/below base (sneha floor pulls down)", () => {
    const { thresholdFn } = makeRig({ valenceFn: () => 0 });
    let theta = thresholdFn();
    for (let i = 0; i < 5; i++) theta = thresholdFn();
    expect(theta).toBeGreaterThanOrEqual(0.3);
    expect(theta).toBeLessThanOrEqual(0.9);
    // Sneha never drops below its 0.10 floor → θ ≤ base − |w_sneha|·0.10·(≈)
    expect(theta).toBeLessThanOrEqual(0.6);
  });

  it("sustained sukha with sneha-dominant weights lowers θ vs neutral", () => {
    const cfg = modConfig({ weights: { sneha: -0.3, mana: 0 } });
    const sukha = makeRig({ valenceFn: () => 0.9, config: cfg });
    const neutral = makeRig({ valenceFn: () => 0, config: cfg });
    let thetaSukha = sukha.thresholdFn();
    let thetaNeutral = neutral.thresholdFn();
    for (let i = 0; i < 11; i++) {
      thetaSukha = sukha.thresholdFn();
      thetaNeutral = neutral.thresholdFn();
    }
    expect(thetaSukha).toBeLessThan(thetaNeutral);
    // After ~12 sukha samples the integrator is well above floor: θ < 0.5
    expect(thetaSukha).toBeLessThan(0.5);
  });

  it("mana-only weights never pull θ below base (mana ≥ 0)", () => {
    const cfg = modConfig({ weights: { sneha: 0, mana: 0.3 } });
    const { thresholdFn } = makeRig({ valenceFn: () => 0.9, config: cfg });
    let theta = thresholdFn();
    for (let i = 0; i < 7; i++) theta = thresholdFn();
    expect(theta).toBeGreaterThanOrEqual(0.6);
    expect(theta).toBeLessThanOrEqual(0.9);
  });

  it("extreme weights clamp exactly to min / max bounds", () => {
    // sneha ≥ floor 0.10 always, so ±10 weights guarantee both clamps fire.
    const low = makeRig({ valenceFn: () => 0.9, config: modConfig({ weights: { sneha: -10, mana: 0 } }) });
    const high = makeRig({ valenceFn: () => 0.9, config: modConfig({ weights: { sneha: 10, mana: 0 } }) });
    expect(low.thresholdFn()).toBe(0.3);
    expect(high.thresholdFn()).toBe(0.9);
  });

  it("emits 'klesha:modulation' with the bundle and resulting θ", () => {
    const bus: EventBus = { on: vi.fn(() => () => {}), once: vi.fn(() => () => {}), onAny: vi.fn(() => () => {}), emit: vi.fn() };
    const { thresholdFn } = makeRig({ valenceFn: () => 0.5, bus });
    const theta = thresholdFn();
    expect(bus.emit).toHaveBeenCalledTimes(1);
    const event = (bus.emit as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      type: string;
      payload: { moha: number; drishti: number; mana: number; sneha: number; threshold: number };
    };
    expect(event.type).toBe("klesha:modulation");
    expect(event.payload.threshold).toBe(theta);
    for (const k of ["moha", "drishti", "mana", "sneha"] as const) {
      expect(event.payload[k]).toBeGreaterThanOrEqual(0);
      expect(event.payload[k]).toBeLessThanOrEqual(1);
    }
  });

  it("shares ONE perceiver state stream with direct signal-fn consumers (no duplication)", () => {
    // The volition path (getKleshaSignals) and the threshold path must read
    // the same perceiver set: threshold calls advance Sneha's integral, and a
    // subsequent direct signal call sees the accumulated value, not a fresh
    // floor-level instance.
    const { thresholdFn, signalFn } = makeRig({
      valenceFn: () => 0.9,
      config: modConfig({ weights: { sneha: -0.3, mana: 0 } }),
    });
    for (let i = 0; i < 8; i++) thresholdFn();
    const bundle = signalFn();
    expect(bundle.sneha).toBeGreaterThan(0.2); // well above the 0.10 floor
  });
});
