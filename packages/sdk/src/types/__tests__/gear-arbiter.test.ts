/**
 * Tests for IGearArbiter SDK type utilities.
 * @see types/gear-arbiter.ts
 */
import { describe, it, expect } from "vitest";
import {
  isGearArbiter,
  DEFAULT_MANO_AGGREGATOR_CONFIG,
  DEFAULT_RISK_DELTA,
  computeAdjustedThreshold,
  inferRiskCategory,
} from "../gear-arbiter.js";
import type { IGearArbiter, GearContext, GearEvaluation } from "../gear-arbiter.js";

describe("isGearArbiter", () => {
  it("returns false for null", () => {
    expect(isGearArbiter(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isGearArbiter(undefined)).toBe(false);
  });

  it("returns false for empty object", () => {
    expect(isGearArbiter({})).toBe(false);
  });

  it("returns false when id is missing", () => {
    expect(isGearArbiter({ priority: 1, evaluate: () => ({}) })).toBe(false);
  });

  it("returns false when priority is not a number", () => {
    expect(isGearArbiter({ id: "test", priority: "high", evaluate: () => ({}) })).toBe(false);
  });

  it("returns false when evaluate is not a function", () => {
    expect(isGearArbiter({ id: "test", priority: 1, evaluate: "not-a-fn" })).toBe(false);
  });

  it("returns false when evaluate.length > 1", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    expect(isGearArbiter({ id: "test", priority: 1, evaluate: (_a: unknown, _b: unknown) => ({}) })).toBe(false);
  });

  it("returns true for valid arbiter (sync)", () => {
    const arbiter: IGearArbiter = {
      id: "test-arbiter",
      priority: 10,
      evaluate: (_ctx: GearContext): GearEvaluation => ({
        action: 1,
        confidence: 0.8,
      }),
    };
    expect(isGearArbiter(arbiter)).toBe(true);
  });

  it("returns true for valid arbiter with evaluate.length === 0", () => {
    expect(isGearArbiter({
      id: "test",
      priority: 0,
      evaluate: () => ({ action: 'abstain', confidence: 0 }),
    })).toBe(true);
  });
});

describe("DEFAULT_MANO_AGGREGATOR_CONFIG", () => {
  it("has expected default values", () => {
    expect(DEFAULT_MANO_AGGREGATOR_CONFIG.perArbiterMs).toBe(100);
    expect(DEFAULT_MANO_AGGREGATOR_CONFIG.chainMs).toBe(200);
    expect(DEFAULT_MANO_AGGREGATOR_CONFIG.defaultGear).toBe(2);
    expect(DEFAULT_MANO_AGGREGATOR_CONFIG.baseThreshold).toBe(0.6);
    expect(DEFAULT_MANO_AGGREGATOR_CONFIG.maxConfidenceByGear).toEqual({ 1: 0.95 });
    expect(DEFAULT_MANO_AGGREGATOR_CONFIG.riskDelta).toEqual(DEFAULT_RISK_DELTA);
    expect(DEFAULT_MANO_AGGREGATOR_CONFIG.thresholdFloor).toBe(0.3);
    expect(DEFAULT_MANO_AGGREGATOR_CONFIG.thresholdCeiling).toBe(0.9);
  });
});

describe("computeAdjustedThreshold (SDK utility)", () => {
  it("adjusts threshold based on risk category and delta config", () => {
    expect(computeAdjustedThreshold(0.6, "destructive", DEFAULT_RISK_DELTA)).toBe(0.8);
    expect(computeAdjustedThreshold(0.6, "informational", DEFAULT_RISK_DELTA)).toBe(0.5);
  });

  it("clamps to default [0.3, 0.9]", () => {
    expect(computeAdjustedThreshold(0.85, "destructive", DEFAULT_RISK_DELTA)).toBe(0.9);
    expect(computeAdjustedThreshold(0.3, "informational", DEFAULT_RISK_DELTA)).toBe(0.3);
  });

  it("clamps to custom floor/ceiling when provided", () => {
    expect(computeAdjustedThreshold(0.85, "destructive", DEFAULT_RISK_DELTA, 0.2, 0.95)).toBe(0.95);
    expect(computeAdjustedThreshold(0.3, "informational", DEFAULT_RISK_DELTA, 0.25, 0.9)).toBe(0.25);
  });
});

describe("inferRiskCategory (SDK utility for plugins)", () => {
  it("classifies tool names by heuristic", () => {
    expect(inferRiskCategory("delete-file")).toBe("destructive");
    expect(inferRiskCategory("write-config")).toBe("state_modifying");
    expect(inferRiskCategory("read-log")).toBe("read_only");
    expect(inferRiskCategory("ping")).toBe("informational");
  });
});

describe("N-Gear generalization", () => {
  it("GearAction accepts arbitrary gear numbers", () => {
    const eval1: GearEvaluation = { action: 1, confidence: 0.8 };
    const eval3: GearEvaluation = { action: 3, confidence: 0.7 };
    const eval5: GearEvaluation = { action: 5, confidence: 0.6 };
    const evalAbstain: GearEvaluation = { action: 'abstain', confidence: 0 };
    expect(eval1.action).toBe(1);
    expect(eval3.action).toBe(3);
    expect(eval5.action).toBe(5);
    expect(evalAbstain.action).toBe('abstain');
  });
});
