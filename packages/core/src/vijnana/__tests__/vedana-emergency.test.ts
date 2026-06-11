/**
 * Tests for VedanaEmergency pure function.
 * @see vijnana/vedana-emergency.ts
 */
import { describe, it, expect } from "vitest";
import {
  createVedanaEmergencyState,
  checkVedanaEmergency,
} from "../vedana-emergency.js";
import type { ChannelVedana, VedanaEmergencyConfig } from "@openstarry/sdk";
import { DEFAULT_VEDANA_EMERGENCY_CONFIG } from "@openstarry/sdk";

function makeDukkha(intensity: number): ChannelVedana {
  return { valence: -0.9, intensity, type: 'dukkha', source: 'test' };
}

function makeSukha(intensity = 0.5): ChannelVedana {
  return { valence: 0.8, intensity, type: 'sukha', source: 'test' };
}

function makeUpekkha(intensity = 0.3): ChannelVedana {
  return { valence: 0.0, intensity, type: 'upekkha', source: 'test' };
}

const cfg = DEFAULT_VEDANA_EMERGENCY_CONFIG; // { intensityThreshold:0.8, sustainedTicks:5, maxThresholdBoost:0.15, cooldownTicks:10 }

describe("checkVedanaEmergency", () => {
  it("no dukkha → no boost, ticks stay 0", () => {
    const state = createVedanaEmergencyState();
    const result = checkVedanaEmergency(makeSukha(), state);
    expect(result.thresholdBoost).toBe(0);
    expect(result.updatedState.consecutiveDukkhaTicks).toBe(0);
    expect(result.updatedState.cooldownRemaining).toBe(0);
  });

  it("sustained dukkha reaching threshold → boost = maxThresholdBoost", () => {
    let state = createVedanaEmergencyState();
    const dukkha = makeDukkha(0.9); // intensity >= 0.8
    // Tick 1..4: no boost yet
    for (let i = 0; i < cfg.sustainedTicks - 1; i++) {
      const r = checkVedanaEmergency(dukkha, state);
      expect(r.thresholdBoost).toBe(0);
      state = r.updatedState;
    }
    expect(state.consecutiveDukkhaTicks).toBe(cfg.sustainedTicks - 1);
    // Tick 5: trigger
    const r = checkVedanaEmergency(dukkha, state);
    expect(r.thresholdBoost).toBe(cfg.maxThresholdBoost);
    expect(r.updatedState.consecutiveDukkhaTicks).toBe(0);
    expect(r.updatedState.cooldownRemaining).toBe(cfg.cooldownTicks);
  });

  it("dukkha interrupted before threshold → no boost, reset", () => {
    let state = createVedanaEmergencyState();
    const dukkha = makeDukkha(0.9);
    // 3 ticks of dukkha
    for (let i = 0; i < 3; i++) {
      const r = checkVedanaEmergency(dukkha, state);
      state = r.updatedState;
    }
    expect(state.consecutiveDukkhaTicks).toBe(3);
    // Interrupted by sukha
    const r = checkVedanaEmergency(makeSukha(), state);
    expect(r.thresholdBoost).toBe(0);
    expect(r.updatedState.consecutiveDukkhaTicks).toBe(0);
  });

  it("after trigger → cooldown period with no boost", () => {
    let state = createVedanaEmergencyState();
    const dukkha = makeDukkha(0.9);
    // Trigger emergency
    for (let i = 0; i < cfg.sustainedTicks; i++) {
      const r = checkVedanaEmergency(dukkha, state);
      state = r.updatedState;
    }
    expect(state.cooldownRemaining).toBe(cfg.cooldownTicks);
    // During cooldown: even with dukkha, no boost
    for (let i = 0; i < cfg.cooldownTicks; i++) {
      const r = checkVedanaEmergency(dukkha, state);
      expect(r.thresholdBoost).toBe(0);
      state = r.updatedState;
    }
    expect(state.cooldownRemaining).toBe(0);
  });

  it("cooldown expires → can trigger again", () => {
    let state = createVedanaEmergencyState();
    const dukkha = makeDukkha(0.9);
    // First trigger
    for (let i = 0; i < cfg.sustainedTicks; i++) {
      state = checkVedanaEmergency(dukkha, state).updatedState;
    }
    // Exhaust cooldown
    for (let i = 0; i < cfg.cooldownTicks; i++) {
      state = checkVedanaEmergency(dukkha, state).updatedState;
    }
    expect(state.cooldownRemaining).toBe(0);
    // Re-accumulate and trigger again
    for (let i = 0; i < cfg.sustainedTicks - 1; i++) {
      state = checkVedanaEmergency(dukkha, state).updatedState;
    }
    const r = checkVedanaEmergency(dukkha, state);
    expect(r.thresholdBoost).toBe(cfg.maxThresholdBoost);
  });

  it("custom config injection works", () => {
    const customCfg: VedanaEmergencyConfig = {
      intensityThreshold: 0.5,
      sustainedTicks: 2,
      maxThresholdBoost: 0.3,
      cooldownTicks: 3,
    };
    let state = createVedanaEmergencyState();
    const dukkha = makeDukkha(0.6); // above custom threshold 0.5
    // Tick 1: no boost
    const r1 = checkVedanaEmergency(dukkha, state, customCfg);
    expect(r1.thresholdBoost).toBe(0);
    state = r1.updatedState;
    // Tick 2: trigger
    const r2 = checkVedanaEmergency(dukkha, state, customCfg);
    expect(r2.thresholdBoost).toBe(0.3);
    expect(r2.updatedState.cooldownRemaining).toBe(3);
  });

  it("edge: exactly at intensity threshold triggers accumulation", () => {
    const state = createVedanaEmergencyState();
    const dukkhaAtThreshold = makeDukkha(cfg.intensityThreshold); // exactly 0.8
    const r = checkVedanaEmergency(dukkhaAtThreshold, state);
    expect(r.thresholdBoost).toBe(0);
    expect(r.updatedState.consecutiveDukkhaTicks).toBe(1);
  });

  it("edge: sukha vedana → no accumulation", () => {
    let state = createVedanaEmergencyState();
    for (let i = 0; i < cfg.sustainedTicks + 2; i++) {
      state = checkVedanaEmergency(makeSukha(0.9), state).updatedState;
    }
    expect(state.consecutiveDukkhaTicks).toBe(0);
    expect(state.cooldownRemaining).toBe(0);
  });

  it("edge: upekkha vedana → no accumulation", () => {
    let state = createVedanaEmergencyState();
    for (let i = 0; i < cfg.sustainedTicks + 2; i++) {
      state = checkVedanaEmergency(makeUpekkha(0.9), state).updatedState;
    }
    expect(state.consecutiveDukkhaTicks).toBe(0);
    expect(state.cooldownRemaining).toBe(0);
  });
});
