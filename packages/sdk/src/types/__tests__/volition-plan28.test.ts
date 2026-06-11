/**
 * Tests for Plan28 IVolition v1 SDK type extensions.
 * - DeliberationContext structural conformance
 * - PlanDeliberationInput / ActionDeliberationInput backward compat
 * - VedanaEmergencyConfig / MohaConfig default validation
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_VEDANA_EMERGENCY_CONFIG,
  DEFAULT_MOHA_CONFIG,
} from "../../index.js";
import type {
  DeliberationContext,
  PlanDeliberationInput,
  ActionDeliberationInput,
  VedanaEmergencyConfig,
  MohaConfig,
  RouteResult,
  ActionRecord,
  KleshaSignalBundle,
  VedanaAssessment,
  ChannelVedana,
} from "../../index.js";

// Helpers
function makeRouteResult(overrides?: Partial<RouteResult>): RouteResult {
  return {
    gear: 2,
    confidence: 0.8,
    riskAdjusted: false,
    ...overrides,
  };
}

function makeKleshaSignals(): KleshaSignalBundle {
  return { moha: 0, drishti: 0, mana: 0, sneha: 0 };
}

function makeVedanaAssessment(): VedanaAssessment {
  const ch: ChannelVedana = { valence: 0, intensity: 0, type: "upekkha", source: "test" };
  return { aggregate: ch, channels: [ch], pidOutput: 0, timestamp: Date.now() };
}

describe("DeliberationContext", () => {
  it("holds routeResult and actionHistory", () => {
    const ctx: DeliberationContext = {
      routeResult: makeRouteResult(),
      actionHistory: [{ name: "fs.read", success: true, timestamp: Date.now() }],
    };
    expect(ctx.routeResult.gear).toBe(2);
    expect(ctx.actionHistory).toHaveLength(1);
  });

  it("accepts empty actionHistory", () => {
    const ctx: DeliberationContext = {
      routeResult: makeRouteResult(),
      actionHistory: [],
    };
    expect(ctx.actionHistory).toHaveLength(0);
  });

  it("includes riskCategory from RouteResult", () => {
    const ctx: DeliberationContext = {
      routeResult: makeRouteResult({ riskCategory: "destructive" }),
      actionHistory: [],
    };
    expect(ctx.routeResult.riskCategory).toBe("destructive");
  });
});

describe("PlanDeliberationInput backward compatibility", () => {
  it("works without deliberationContext (v0 compat)", () => {
    const input: PlanDeliberationInput = {
      proposedActions: [{ name: "fs.read", arguments: {} }],
      kleshaSignals: makeKleshaSignals(),
      vedanaAssessment: makeVedanaAssessment(),
    };
    expect(input.deliberationContext).toBeUndefined();
  });

  it("accepts deliberationContext when provided (v1)", () => {
    const input: PlanDeliberationInput = {
      proposedActions: [{ name: "fs.write", arguments: { path: "/tmp/x" } }],
      kleshaSignals: makeKleshaSignals(),
      vedanaAssessment: makeVedanaAssessment(),
      deliberationContext: {
        routeResult: makeRouteResult({ riskCategory: "state_modifying" }),
        actionHistory: [],
      },
    };
    expect(input.deliberationContext?.routeResult.riskCategory).toBe("state_modifying");
  });
});

describe("ActionDeliberationInput backward compatibility", () => {
  it("works without deliberationContext (v0 compat)", () => {
    const input: ActionDeliberationInput = {
      proposedAction: { name: "fs.read", arguments: {} },
      kleshaSignals: makeKleshaSignals(),
      vedanaAssessment: makeVedanaAssessment(),
      planContext: { modifiedPlan: null, reasoning: "allow" },
    };
    expect(input.deliberationContext).toBeUndefined();
  });

  it("accepts deliberationContext when provided (v1)", () => {
    const input: ActionDeliberationInput = {
      proposedAction: { name: "fs.delete", arguments: { path: "/tmp/x" } },
      kleshaSignals: makeKleshaSignals(),
      vedanaAssessment: makeVedanaAssessment(),
      planContext: { modifiedPlan: null, reasoning: "allow" },
      deliberationContext: {
        routeResult: makeRouteResult({ riskCategory: "destructive" }),
        actionHistory: [{ name: "fs.read", success: true, timestamp: Date.now() }],
      },
    };
    expect(input.deliberationContext?.routeResult.riskCategory).toBe("destructive");
  });
});

describe("VedanaEmergencyConfig defaults", () => {
  it("has valid default values", () => {
    const cfg: VedanaEmergencyConfig = DEFAULT_VEDANA_EMERGENCY_CONFIG;
    expect(cfg.intensityThreshold).toBe(0.8);
    expect(cfg.sustainedTicks).toBe(5);
    expect(cfg.maxThresholdBoost).toBe(0.15);
    expect(cfg.cooldownTicks).toBe(10);
  });

  it("all defaults are positive", () => {
    expect(DEFAULT_VEDANA_EMERGENCY_CONFIG.intensityThreshold).toBeGreaterThan(0);
    expect(DEFAULT_VEDANA_EMERGENCY_CONFIG.sustainedTicks).toBeGreaterThan(0);
    expect(DEFAULT_VEDANA_EMERGENCY_CONFIG.maxThresholdBoost).toBeGreaterThan(0);
    expect(DEFAULT_VEDANA_EMERGENCY_CONFIG.cooldownTicks).toBeGreaterThan(0);
  });
});

describe("MohaConfig defaults", () => {
  it("has valid default values", () => {
    const cfg: MohaConfig = DEFAULT_MOHA_CONFIG;
    expect(cfg.alphaM).toBe(0.02);
    expect(cfg.betaM).toBe(5.0);
  });

  it("all defaults are positive", () => {
    expect(DEFAULT_MOHA_CONFIG.alphaM).toBeGreaterThan(0);
    expect(DEFAULT_MOHA_CONFIG.betaM).toBeGreaterThan(0);
  });
});

describe("RouteResult.riskCategory", () => {
  it("is optional (backward compat)", () => {
    const result: RouteResult = {
      gear: 2,
      confidence: 0.7,
      riskAdjusted: false,
    };
    expect(result.riskCategory).toBeUndefined();
  });

  it("accepts all four risk categories", () => {
    const categories = ["destructive", "state_modifying", "read_only", "informational"] as const;
    for (const cat of categories) {
      const result: RouteResult = {
        gear: 1,
        confidence: 0.9,
        riskAdjusted: true,
        riskCategory: cat,
      };
      expect(result.riskCategory).toBe(cat);
    }
  });
});
