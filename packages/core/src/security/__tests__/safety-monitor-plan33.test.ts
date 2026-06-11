/**
 * Tests for postRouteCheck v2 (Plan33 D-31-1).
 * - Token budget flag
 * - Confidence floor flag
 * - Non-blocking (never rejects)
 */
import { describe, it, expect } from "vitest";
import { createSafetyMonitor } from "../safety-monitor.js";
import type { RouteResult } from "@openstarry/sdk";
import { DEFAULT_SAFETY_MONITOR_CONFIG } from "@openstarry/sdk";

describe("SafetyMonitor.postRouteCheck v2 (Plan33)", () => {
  it("returns routeResult unchanged when no budget/floor configured", () => {
    const monitor = createSafetyMonitor(DEFAULT_SAFETY_MONITOR_CONFIG);
    const input: RouteResult = { gear: 1, confidence: 0.9 };
    const result = monitor.postRouteCheck(input);
    expect(result).toBe(input); // Same reference — no flags
  });

  it("sets tokenBudgetExceeded flag when tokens exceed budget", () => {
    const monitor = createSafetyMonitor(DEFAULT_SAFETY_MONITOR_CONFIG, {
      maxTokenBudget: 100,
    });
    // Simulate token usage exceeding budget
    monitor.trackTokenUsage(150);
    const input: RouteResult = { gear: 2, confidence: 0.8 };
    const result = monitor.postRouteCheck(input);
    expect(result.flags?.tokenBudgetExceeded).toBe(true);
    expect(result.gear).toBe(2); // Original fields preserved
  });

  it("does not set tokenBudgetExceeded when under budget", () => {
    const monitor = createSafetyMonitor(DEFAULT_SAFETY_MONITOR_CONFIG, {
      maxTokenBudget: 1000,
    });
    monitor.trackTokenUsage(50);
    const input: RouteResult = { gear: 1, confidence: 0.9 };
    const result = monitor.postRouteCheck(input);
    expect(result.flags?.tokenBudgetExceeded).toBeUndefined();
  });

  it("sets lowConfidence flag when below confidence floor", () => {
    const monitor = createSafetyMonitor(DEFAULT_SAFETY_MONITOR_CONFIG, {
      confidenceFloor: 0.7,
    });
    const input: RouteResult = { gear: 1, confidence: 0.3 };
    const result = monitor.postRouteCheck(input);
    expect(result.flags?.lowConfidence).toBe(true);
  });

  it("does not set lowConfidence when above floor", () => {
    const monitor = createSafetyMonitor(DEFAULT_SAFETY_MONITOR_CONFIG, {
      confidenceFloor: 0.5,
    });
    const input: RouteResult = { gear: 1, confidence: 0.8 };
    const result = monitor.postRouteCheck(input);
    expect(result.flags?.lowConfidence).toBeUndefined();
  });

  it("sets both flags simultaneously", () => {
    const monitor = createSafetyMonitor(DEFAULT_SAFETY_MONITOR_CONFIG, {
      maxTokenBudget: 50,
      confidenceFloor: 0.9,
    });
    monitor.trackTokenUsage(100);
    const input: RouteResult = { gear: 1, confidence: 0.3 };
    const result = monitor.postRouteCheck(input);
    expect(result.flags?.tokenBudgetExceeded).toBe(true);
    expect(result.flags?.lowConfidence).toBe(true);
  });

  it("never rejects (non-blocking) — always returns a RouteResult", () => {
    const monitor = createSafetyMonitor(DEFAULT_SAFETY_MONITOR_CONFIG, {
      maxTokenBudget: 1,
      confidenceFloor: 1.0,
    });
    monitor.trackTokenUsage(999999);
    const input: RouteResult = { gear: 1, confidence: 0 };
    const result = monitor.postRouteCheck(input);
    // Still returns a RouteResult with gear intact
    expect(result.gear).toBe(1);
    expect(typeof result).toBe("object");
  });

  it("preserves existing flags on routeResult", () => {
    const monitor = createSafetyMonitor(DEFAULT_SAFETY_MONITOR_CONFIG, {
      maxTokenBudget: 10,
    });
    monitor.trackTokenUsage(100);
    const input: RouteResult = { gear: 1, confidence: 0.5, flags: { customFlag: true } };
    const result = monitor.postRouteCheck(input);
    expect(result.flags?.customFlag).toBe(true);
    expect(result.flags?.tokenBudgetExceeded).toBe(true);
  });

  it("uses SDK defaults (Infinity / 0) when no options provided", () => {
    const monitor = createSafetyMonitor(DEFAULT_SAFETY_MONITOR_CONFIG);
    monitor.trackTokenUsage(999999);
    const input: RouteResult = { gear: 1, confidence: 0 };
    const result = monitor.postRouteCheck(input);
    // Infinity budget → never exceeded; 0 floor → never triggered
    expect(result).toBe(input);
  });
});
