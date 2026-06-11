/**
 * Klesha-modulated gear arbitration — the N=2 closed-loop proof
 * (TENET-2026-06-11; completes Tenet #8 / Doc 37).
 *
 * Routes the SAME arbiter (confidence 0.55) through one real ManoAggregator
 * twice: with a neutral vedana history θ(t) ≈ 0.57 and the strict
 * `confidence > threshold` gate rejects (default gear 2); after sustained
 * sukha the Sneha integrator drives θ(t) below 0.5 and the identical
 * evaluation is accepted (gear 1). Same agent, same arbiter, two different
 * routing outcomes caused ONLY by the agent's felt experience — the
 * vedana → klesha → θ(t) → gear feedback loop, end to end through route().
 */

import { describe, it, expect, vi } from "vitest";
import { createManoAggregator } from "../mano-aggregator.js";
import { createKleshaSignalFn, createKleshaThresholdFn } from "../../agents/agent-core.js";
import { createDefaultKleshas, KleshaModulatedDispatcher } from "../../vijnana/klesha.js";
import type {
  ChannelVedana,
  VedanaAssessment,
  IGearArbiter,
  GearContext,
  GearEvaluation,
  EventBus,
} from "@openstarry/sdk";

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
    agentConfig: { id: "tenet-test-agent" },
  };
}

function assessmentOf(valence: number): VedanaAssessment {
  const aggregate: ChannelVedana = {
    valence,
    intensity: 0.8,
    type: valence > 0.3 ? "sukha" : valence < -0.3 ? "dukkha" : "upekkha",
    source: "test",
  };
  return { aggregate, channels: [aggregate], pidOutput: valence * 0.8, timestamp: 1 };
}

function makeModulatedAggregator() {
  let currentValence = 0;
  const perceivers = createDefaultKleshas();
  const signalFn = createKleshaSignalFn(perceivers, () => assessmentOf(currentValence), []);
  const dispatcher = new KleshaModulatedDispatcher([...perceivers], {
    baseThreshold: 0.6,
    minThreshold: 0.3,
    maxThreshold: 0.9,
    // Deterministic: sneha-only modulation (mana PD excluded from θ).
    weights: { sneha: -0.3, mana: 0 },
  });
  const thresholdFn = createKleshaThresholdFn(dispatcher, signalFn);
  const aggregator = createManoAggregator(makeBus(), undefined, thresholdFn);
  return { aggregator, setValence: (v: number) => { currentValence = v; } };
}

describe("ManoAggregator × klesha modulation — closed-loop gear flip (TENET-2026-06-11)", () => {
  const arbiter: IGearArbiter = {
    id: "fast-path",
    priority: 10,
    evaluate: (): GearEvaluation => ({ action: 1, confidence: 0.55 }),
  };

  it("neutral history rejects (gear 2) → sustained sukha accepts the SAME evaluation (gear 1)", async () => {
    const { aggregator, setValence } = makeModulatedAggregator();

    // Route A — neutral feelings: sneha sits at its 0.10 floor,
    // θ ≈ 0.6 − 0.3×0.10 = 0.57 → 0.55 > 0.57 is false → default gear.
    const routeA = await aggregator.route(makeContext(), [arbiter]);
    expect(routeA.gear).toBe(2);

    // Sustained pleasant experience: each route() samples vedana once and
    // advances the Sneha integral (≈0.5 after ~6 sukha samples — enough to
    // flip, while keeping the risk-delta test below deterministic too).
    setValence(0.9);
    for (let i = 0; i < 6; i++) {
      await aggregator.route(makeContext(), [arbiter]);
    }

    // Route B — identical arbiter, identical confidence: θ(t) ≈ 0.45 now,
    // 0.55 > θ true → gear 1, decided by the arbiter.
    const routeB = await aggregator.route(makeContext(), [arbiter]);
    expect(routeB.gear).toBe(1);
    expect(routeB.decidedBy).toBe("fast-path");
  });

  it("downstream risk weighting still composes on top of θ(t)", async () => {
    const { aggregator, setValence } = makeModulatedAggregator();
    setValence(0.9);
    for (let i = 0; i < 6; i++) {
      await aggregator.route(makeContext(), [arbiter]);
    }
    // Same warmed-up θ(t) ≈ 0.42-0.47, but a destructive risk category
    // re-raises the effective threshold (+0.20 per DEFAULT risk deltas) to
    // ≈ 0.62-0.67: 0.55 > θ+0.20 is false → fast path correctly blocked.
    // (Warm-up is capped at 6 on purpose — by ~12 sukha samples sneha ≈ 0.85
    // drives θ to ≈ 0.35 and even the +0.20 risk delta no longer blocks.)
    const risky: IGearArbiter = {
      id: "risky-path",
      priority: 10,
      evaluate: (): GearEvaluation => ({ action: 1, confidence: 0.55, riskCategory: "destructive" }),
    };
    const result = await aggregator.route(makeContext(), [risky]);
    expect(result.gear).toBe(2);
  });

  it("without a thresholdFn the static baseThreshold path is unchanged (legacy)", async () => {
    const aggregator = createManoAggregator(makeBus());
    // 0.55 > 0.6 false regardless of history — pre-v0.59 behavior.
    const result = await aggregator.route(makeContext(), [arbiter]);
    expect(result.gear).toBe(2);
  });
});
