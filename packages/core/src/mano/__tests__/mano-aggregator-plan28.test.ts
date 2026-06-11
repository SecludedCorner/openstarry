/**
 * Tests for Plan28 ManoAggregator extensions.
 * - riskCategory propagation in RouteResult
 * @see mano/mano-aggregator.ts
 */
import { describe, it, expect, vi } from "vitest";
import { createManoAggregator } from "../mano-aggregator.js";
import type { IGearArbiter, GearContext, GearEvaluation, GearAction, EventBus, RiskCategory } from "@openstarry/sdk";

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
    agentConfig: { id: "test-agent" },
  };
}

function makeArbiter(
  id: string,
  priority: number,
  action: GearAction,
  confidence: number,
  riskCategory?: RiskCategory,
): IGearArbiter {
  return {
    id,
    priority,
    evaluate: (): GearEvaluation => ({ action, confidence, riskCategory }),
  };
}

describe("ManoAggregator riskCategory propagation (Plan28)", () => {
  it("propagates riskCategory from winning arbiter to RouteResult", async () => {
    const bus = makeBus();
    const agg = createManoAggregator(bus);
    const arbiter = makeArbiter("a1", 1, 1, 0.9, "destructive");
    const result = await agg.route(makeContext(), [arbiter]);
    expect(result.riskCategory).toBe("destructive");
  });

  it("riskCategory is undefined when arbiter provides none", async () => {
    const bus = makeBus();
    const agg = createManoAggregator(bus);
    const arbiter = makeArbiter("a1", 1, 1, 0.9);
    const result = await agg.route(makeContext(), [arbiter]);
    expect(result.riskCategory).toBeUndefined();
  });

  it("riskCategory is undefined for forceNextGear path", async () => {
    const bus = makeBus();
    const agg = createManoAggregator(bus);
    agg.forceNextGear(1);
    const result = await agg.route(makeContext(), []);
    expect(result.riskCategory).toBeUndefined();
  });

  it("riskCategory is undefined for G-1 path (no arbiters)", async () => {
    const bus = makeBus();
    const agg = createManoAggregator(bus);
    const result = await agg.route(makeContext(), []);
    expect(result.riskCategory).toBeUndefined();
  });

  it("propagates state_modifying riskCategory correctly", async () => {
    const bus = makeBus();
    const agg = createManoAggregator(bus);
    const arbiter = makeArbiter("a1", 1, 2, 0.85, "state_modifying");
    const result = await agg.route(makeContext(), [arbiter]);
    expect(result.riskCategory).toBe("state_modifying");
  });
});
