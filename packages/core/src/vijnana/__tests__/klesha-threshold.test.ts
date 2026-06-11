/**
 * Tests for risk-weighted threshold computation (re-exported from SDK).
 * @see vijnana/klesha-threshold.ts → @openstarry/sdk gear-arbiter.ts
 */
import { describe, it, expect } from "vitest";
import {
  computeAdjustedThreshold,
  inferRiskCategory,
  DEFAULT_RISK_DELTA,
} from "../klesha-threshold.js";

describe("DEFAULT_RISK_DELTA", () => {
  it("has correct values for all categories", () => {
    expect(DEFAULT_RISK_DELTA.destructive).toBe(0.20);
    expect(DEFAULT_RISK_DELTA.state_modifying).toBe(0.10);
    expect(DEFAULT_RISK_DELTA.read_only).toBe(0.00);
    expect(DEFAULT_RISK_DELTA.informational).toBe(-0.10);
  });
});

describe("computeAdjustedThreshold", () => {
  it("raises threshold for destructive actions", () => {
    const result = computeAdjustedThreshold(0.6, "destructive", DEFAULT_RISK_DELTA);
    expect(result).toBe(0.8); // 0.6 + 0.20
  });

  it("raises threshold for state-modifying actions", () => {
    const result = computeAdjustedThreshold(0.6, "state_modifying", DEFAULT_RISK_DELTA);
    expect(result).toBe(0.7); // 0.6 + 0.10
  });

  it("keeps threshold for read-only actions", () => {
    const result = computeAdjustedThreshold(0.6, "read_only", DEFAULT_RISK_DELTA);
    expect(result).toBe(0.6); // 0.6 + 0.00
  });

  it("lowers threshold for informational actions", () => {
    const result = computeAdjustedThreshold(0.6, "informational", DEFAULT_RISK_DELTA);
    expect(result).toBe(0.5); // 0.6 - 0.10
  });

  it("clamps to default floor of 0.3", () => {
    const result = computeAdjustedThreshold(0.3, "informational", DEFAULT_RISK_DELTA);
    expect(result).toBe(0.3); // max(0.3, 0.3 - 0.10) = 0.3
  });

  it("clamps to default ceiling of 0.9", () => {
    const result = computeAdjustedThreshold(0.85, "destructive", DEFAULT_RISK_DELTA);
    expect(result).toBe(0.9); // min(0.9, 0.85 + 0.20) = 0.9
  });

  it("respects custom floor/ceiling", () => {
    expect(computeAdjustedThreshold(0.85, "destructive", DEFAULT_RISK_DELTA, 0.2, 0.95)).toBe(0.95);
    expect(computeAdjustedThreshold(0.3, "informational", DEFAULT_RISK_DELTA, 0.25, 0.9)).toBe(0.25);
  });
});

describe("inferRiskCategory", () => {
  it("detects destructive actions", () => {
    expect(inferRiskCategory("delete-file")).toBe("destructive");
    expect(inferRiskCategory("removeUser")).toBe("destructive");
    expect(inferRiskCategory("drop-database")).toBe("destructive");
    expect(inferRiskCategory("destroy-instance")).toBe("destructive");
  });

  it("detects state-modifying actions", () => {
    expect(inferRiskCategory("write-file")).toBe("state_modifying");
    expect(inferRiskCategory("updateConfig")).toBe("state_modifying");
    expect(inferRiskCategory("create-user")).toBe("state_modifying");
  });

  it("detects read-only actions", () => {
    expect(inferRiskCategory("read-file")).toBe("read_only");
    expect(inferRiskCategory("getUser")).toBe("read_only");
    // list-files → informational per CONSTRAINT-D6 (Plan39 W1, AC-W1-5)
    expect(inferRiskCategory("list-files")).toBe("informational");
    expect(inferRiskCategory("search-index")).toBe("read_only");
  });

  it("defaults to informational for unknown actions", () => {
    expect(inferRiskCategory("help")).toBe("informational");
    expect(inferRiskCategory("status")).toBe("informational");
    expect(inferRiskCategory("ping")).toBe("informational");
  });
});
