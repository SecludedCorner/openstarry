/**
 * Tests for Moha.updateFromAction().
 * @see vijnana/klesha.ts
 */
import { describe, it, expect } from "vitest";
import { Moha } from "../klesha.js";
import type { MohaConfig } from "@openstarry/sdk";
import { DEFAULT_MOHA_CONFIG } from "@openstarry/sdk";

describe("Moha.updateFromAction", () => {
  it("zero repetitionRatio → no change (delta = 0)", () => {
    const moha = new Moha();
    const result = moha.updateFromAction(0.5, 0);
    expect(result).toBe(0.5);
  });

  it("default config produces expected delta", () => {
    const moha = new Moha();
    const currentMoha = 0.0;
    const repetitionRatio = 1.0;
    // delta = alphaM * repetitionRatio / (1 + betaM * currentMoha)
    //       = 0.02 * 1.0 / (1 + 5.0 * 0.0) = 0.02 / 1 = 0.02
    const expected = currentMoha + DEFAULT_MOHA_CONFIG.alphaM * repetitionRatio / (1 + DEFAULT_MOHA_CONFIG.betaM * currentMoha);
    const result = moha.updateFromAction(currentMoha, repetitionRatio);
    expect(result).toBeCloseTo(expected, 10);
  });

  it("custom MohaConfig changes behavior", () => {
    const customCfg: MohaConfig = { alphaM: 0.1, betaM: 2.0 };
    const moha = new Moha(0.3, customCfg);
    const currentMoha = 0.2;
    const repetitionRatio = 0.5;
    // delta = 0.1 * 0.5 / (1 + 2.0 * 0.2) = 0.05 / 1.4 ≈ 0.03571
    const expected = currentMoha + customCfg.alphaM * repetitionRatio / (1 + customCfg.betaM * currentMoha);
    const result = moha.updateFromAction(currentMoha, repetitionRatio);
    expect(result).toBeCloseTo(expected, 10);
  });

  it("diminishing returns: high currentMoha → smaller delta", () => {
    const moha = new Moha();
    const repetitionRatio = 1.0;
    const lowMoha = 0.1;
    const highMoha = 0.9;
    const deltaLow = moha.updateFromAction(lowMoha, repetitionRatio) - lowMoha;
    const deltaHigh = moha.updateFromAction(highMoha, repetitionRatio) - highMoha;
    expect(deltaLow).toBeGreaterThan(deltaHigh);
  });

  it("result clamped at 1.0", () => {
    const moha = new Moha();
    // Start at 1.0: result must not exceed 1.0
    const result = moha.updateFromAction(1.0, 1.0);
    expect(result).toBeLessThanOrEqual(1.0);
    // Start near ceiling with large repetition
    const moha2 = new Moha(0.3, { alphaM: 10.0, betaM: 0.0 });
    const result2 = moha2.updateFromAction(0.95, 1.0);
    expect(result2).toBe(1.0);
  });

  it("high repetitionRatio with zero currentMoha → expected initial boost", () => {
    const moha = new Moha();
    const result = moha.updateFromAction(0.0, 1.0);
    // delta = 0.02 * 1 / (1 + 5 * 0) = 0.02
    expect(result).toBeCloseTo(0.02, 10);
  });
});
