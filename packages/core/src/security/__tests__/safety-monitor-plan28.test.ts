/**
 * Tests for Plan28 SafetyMonitor extensions.
 * - postRouteCheck passthrough
 */
import { describe, it, expect } from "vitest";
import { createSafetyMonitor } from "../safety-monitor.js";
import type { RouteResult } from "@openstarry/sdk";

describe("SafetyMonitor.postRouteCheck (Plan28)", () => {
  it("returns routeResult unchanged (passthrough v1)", () => {
    const monitor = createSafetyMonitor();
    const input: RouteResult = {
      gear: 1,
      decidedBy: "arbiter-1",
      confidence: 0.9,
      riskAdjusted: true,
      riskCategory: "destructive",
    };
    const result = monitor.postRouteCheck(input);
    expect(result).toBe(input); // Same reference — passthrough
  });

  it("preserves all RouteResult fields", () => {
    const monitor = createSafetyMonitor();
    const input: RouteResult = {
      gear: 2,
      confidence: 0.5,
      riskAdjusted: false,
    };
    const result = monitor.postRouteCheck(input);
    expect(result.gear).toBe(2);
    expect(result.confidence).toBe(0.5);
    expect(result.riskAdjusted).toBe(false);
    expect(result.riskCategory).toBeUndefined();
  });
});
