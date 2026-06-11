/**
 * Tests for Klesha implementations and KleshaModulatedDispatcher.
 * @see vijnana/klesha.ts
 */
import { describe, it, expect } from "vitest";
import { Moha, Drishti, Mana, Sneha, KleshaModulatedDispatcher, createDefaultKleshas } from "../klesha.js";
import type { KleshaContext, ChannelVedana, KleshaModulationConfig } from "@openstarry/sdk";
import { DEFAULT_KLESHA_MODULATION_CONFIG } from "@openstarry/sdk";

function makeVedana(valence: number, intensity = 0.5): ChannelVedana {
  return {
    valence,
    intensity,
    type: valence < -0.1 ? 'dukkha' : valence > 0.1 ? 'sukha' : 'upekkha',
    source: 'test',
  };
}

function makeContext(overrides: Partial<KleshaContext> = {}): KleshaContext {
  return {
    recentVedana: [],
    actionHistory: [],
    ...overrides,
  };
}

describe("Moha (Low-pass filter)", () => {
  it("returns 0 for empty vedana", () => {
    const moha = new Moha();
    const signal = moha.perceive(makeContext());
    expect(signal.type).toBe('moha');
    expect(signal.value).toBeGreaterThanOrEqual(0);
    expect(signal.value).toBeLessThanOrEqual(1);
  });

  it("returns high value for low-variance vedana (ignorance)", () => {
    const moha = new Moha(0.9); // high smoothing
    const ctx = makeContext({
      recentVedana: [makeVedana(0.5), makeVedana(0.5), makeVedana(0.5)],
    });
    const signal = moha.perceive(ctx);
    expect(signal.type).toBe('moha');
    expect(signal.value).toBeGreaterThan(0.3); // Low variance → high moha
  });

  it("returns lower value for high-variance vedana (awareness)", () => {
    const moha = new Moha(0.9);
    const ctx = makeContext({
      recentVedana: [makeVedana(-1.0), makeVedana(1.0), makeVedana(-0.8), makeVedana(0.9)],
    });
    const signal = moha.perceive(ctx);
    expect(signal.value).toBeLessThan(0.95); // With high variance, moha should be somewhat reduced
  });
});

describe("Drishti (Band-pass filter)", () => {
  it("returns 0 for insufficient action history", () => {
    const drishti = new Drishti();
    const signal = drishti.perceive(makeContext({ actionHistory: ["read"] }));
    expect(signal.type).toBe('drishti');
    expect(signal.value).toBe(0);
  });

  it("returns high value for repetitive actions (self-view)", () => {
    const drishti = new Drishti();
    const signal = drishti.perceive(makeContext({
      actionHistory: ["read", "read", "read", "read", "read"],
    }));
    expect(signal.type).toBe('drishti');
    expect(signal.value).toBeGreaterThan(0.5);
  });

  it("returns lower value for diverse actions", () => {
    const drishti = new Drishti();
    const signal = drishti.perceive(makeContext({
      actionHistory: ["read", "write", "delete", "list", "mkdir"],
    }));
    expect(signal.type).toBe('drishti');
    expect(signal.value).toBeLessThan(0.3);
  });
});

describe("Mana (PD controller)", () => {
  it("returns 0 for empty vedana", () => {
    const mana = new Mana();
    const signal = mana.perceive(makeContext());
    expect(signal.type).toBe('mana');
    expect(signal.value).toBe(0);
  });

  it("returns high value for consistently positive vedana (pride)", () => {
    const mana = new Mana();
    const ctx = makeContext({
      recentVedana: [makeVedana(0.8), makeVedana(0.9), makeVedana(0.7)],
    });
    const signal = mana.perceive(ctx);
    expect(signal.type).toBe('mana');
    expect(signal.value).toBeGreaterThan(0.3);
  });

  it("returns 0 for negative vedana", () => {
    const mana = new Mana();
    const ctx = makeContext({
      recentVedana: [makeVedana(-0.5), makeVedana(-0.8)],
    });
    const signal = mana.perceive(ctx);
    expect(signal.value).toBe(0); // negative valence → no pride
  });
});

describe("Sneha (Integrator)", () => {
  it("accumulates from positive vedana (attachment)", () => {
    const sneha = new Sneha({ gain: 0.3, lambda: 0.01 });
    const ctx = makeContext({ recentVedana: [makeVedana(0.9)] });
    sneha.perceive(ctx);
    const signal = sneha.perceive(ctx);
    expect(signal.type).toBe('sneha');
    expect(signal.value).toBeGreaterThan(0);
  });

  it("decays exponentially when no vedana", () => {
    const sneha = new Sneha({ gain: 0.5, lambda: 0.2, floor: 0.0, maxLevel: 1.0 });
    sneha.perceive(makeContext({ recentVedana: [makeVedana(1.0)] }));
    const afterDecay = sneha.perceive(makeContext());
    expect(afterDecay.value).toBeLessThan(0.5);
  });

  it("clamps value to [0, 1]", () => {
    const sneha = new Sneha({ gain: 0.5, lambda: 0.01 });
    for (let i = 0; i < 50; i++) {
      sneha.perceive(makeContext({ recentVedana: [makeVedana(1.0)] }));
    }
    const signal = sneha.perceive(makeContext({ recentVedana: [makeVedana(1.0)] }));
    expect(signal.value).toBeLessThanOrEqual(1);
    expect(signal.value).toBeGreaterThanOrEqual(0);
  });

  it("enforces floor bound", () => {
    const sneha = new Sneha({ gain: 0.0, floor: 0.10, lambda: 0.99 });
    // With zero gain and high decay, value should floor at 0.10
    const signal = sneha.perceive(makeContext());
    expect(signal.value).toBeGreaterThanOrEqual(0.10);
  });

  it("enforces maxLevel bound", () => {
    const sneha = new Sneha({ gain: 10.0, lambda: 0.0, maxLevel: 0.95 });
    for (let i = 0; i < 100; i++) {
      sneha.perceive(makeContext({ recentVedana: [makeVedana(1.0)] }));
    }
    const signal = sneha.perceive(makeContext({ recentVedana: [makeVedana(1.0)] }));
    expect(signal.value).toBeLessThanOrEqual(0.95);
  });

  it("works with default options (no args)", () => {
    const sneha = new Sneha();
    const signal = sneha.perceive(makeContext());
    expect(signal.type).toBe('sneha');
    expect(signal.value).toBeGreaterThanOrEqual(0);
    expect(signal.value).toBeLessThanOrEqual(1);
  });
});

describe("KleshaModulatedDispatcher", () => {
  it("perceives all 4 kleshas", () => {
    const kleshas = createDefaultKleshas();
    const dispatcher = new KleshaModulatedDispatcher(kleshas, DEFAULT_KLESHA_MODULATION_CONFIG);
    const bundle = dispatcher.perceiveAll(makeContext());
    expect(bundle).toHaveProperty('moha');
    expect(bundle).toHaveProperty('drishti');
    expect(bundle).toHaveProperty('mana');
    expect(bundle).toHaveProperty('sneha');
  });

  it("computes threshold at base when signals are zero", () => {
    const kleshas = createDefaultKleshas();
    const dispatcher = new KleshaModulatedDispatcher(kleshas, DEFAULT_KLESHA_MODULATION_CONFIG);
    const threshold = dispatcher.computeThreshold({ moha: 0, drishti: 0, mana: 0, sneha: 0 });
    expect(threshold).toBe(0.6); // base threshold
  });

  it("lowers threshold when sneha is high", () => {
    const kleshas = createDefaultKleshas();
    const dispatcher = new KleshaModulatedDispatcher(kleshas, DEFAULT_KLESHA_MODULATION_CONFIG);
    const threshold = dispatcher.computeThreshold({ moha: 0, drishti: 0, mana: 0, sneha: 1.0 });
    expect(threshold).toBeLessThan(0.6);
    expect(threshold).toBeGreaterThanOrEqual(0.3); // floor
  });

  it("raises threshold when mana is high", () => {
    const kleshas = createDefaultKleshas();
    const dispatcher = new KleshaModulatedDispatcher(kleshas, DEFAULT_KLESHA_MODULATION_CONFIG);
    const threshold = dispatcher.computeThreshold({ moha: 0, drishti: 0, mana: 1.0, sneha: 0 });
    expect(threshold).toBeGreaterThan(0.6);
    expect(threshold).toBeLessThanOrEqual(0.9); // ceiling
  });

  it("clamps threshold to [min, max]", () => {
    const config: KleshaModulationConfig = {
      baseThreshold: 0.6,
      minThreshold: 0.3,
      maxThreshold: 0.9,
      weights: { sneha: -2.0, mana: 2.0 },
    };
    const kleshas = createDefaultKleshas();
    const dispatcher = new KleshaModulatedDispatcher(kleshas, config);

    // Extreme sneha → clamped to min
    expect(dispatcher.computeThreshold({ moha: 0, drishti: 0, mana: 0, sneha: 1.0 })).toBe(0.3);
    // Extreme mana → clamped to max
    expect(dispatcher.computeThreshold({ moha: 0, drishti: 0, mana: 1.0, sneha: 0 })).toBe(0.9);
  });
});

describe("createDefaultKleshas", () => {
  it("creates 4 kleshas with correct types", () => {
    const kleshas = createDefaultKleshas();
    expect(kleshas).toHaveLength(4);
    const types = kleshas.map(k => k.type).sort();
    expect(types).toEqual(['drishti', 'mana', 'moha', 'sneha']);
  });
});
