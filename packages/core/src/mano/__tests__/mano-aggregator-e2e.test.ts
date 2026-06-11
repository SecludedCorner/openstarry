/**
 * E2E tests for ManoAggregator using real (inlined) StaticRuleArbiter logic.
 *
 * Rationale: The StaticRuleArbiter lives in an external plugin package that is
 * not importable from core tests. This file inlines a minimal implementation
 * of the same logic to exercise ManoAggregator end-to-end with a real arbiter.
 *
 * @see Plan27b: ManoAggregator + StaticRuleArbiter integration
 * @see mano/mano-aggregator.ts
 * @see vijnana/vitakka-watchdog.ts
 * @see mano/gear-arbiter-registry.ts
 */
import { describe, it, expect, vi } from "vitest";
import { createManoAggregator } from "../mano-aggregator.js";
import { createGearArbiterRegistry } from "../gear-arbiter-registry.js";
import { createVitakkaWatchdog } from "../../vijnana/vitakka-watchdog.js";
import type {
  IGearArbiter,
  GearContext,
  GearEvaluation,
  GearAction,
  EventBus,
  AgentEvent,
  RiskCategory,
} from "@openstarry/sdk";
import { DEFAULT_MANO_AGGREGATOR_CONFIG } from "@openstarry/sdk";

// ---------------------------------------------------------------------------
// Inlined StaticRuleArbiter (mirrors the plugin package logic)
// ---------------------------------------------------------------------------

interface StaticRule {
  /** Substring to match against input or tool names */
  readonly match: string;
  /** Gear to recommend when matched */
  readonly gear: GearAction;
  /** Confidence score to return */
  readonly confidence: number;
  /** Optional risk category */
  readonly riskCategory?: RiskCategory;
}

interface StaticRuleArbiterOptions {
  readonly id: string;
  readonly priority: number;
  readonly rules: readonly StaticRule[];
}

/**
 * Inlined StaticRuleArbiter evaluate logic.
 * Checks input text and proposed tool call names against each rule in order.
 * Returns the first match, or abstains if none match.
 */
function createStaticRuleArbiter(options: StaticRuleArbiterOptions): IGearArbiter {
  return {
    id: options.id,
    priority: options.priority,
    evaluate(context: GearContext): GearEvaluation {
      for (const rule of options.rules) {
        const inputMatches = context.input.toLowerCase().includes(rule.match.toLowerCase());
        const toolMatches = context.proposedToolCalls.some((tc) =>
          tc.name.toLowerCase().includes(rule.match.toLowerCase())
        );

        if (inputMatches || toolMatches) {
          return {
            action: rule.gear,
            confidence: rule.confidence,
            riskCategory: rule.riskCategory,
          };
        }
      }

      // No rule matched — abstain
      return { action: "abstain", confidence: 0 };
    },
  };
}

// ---------------------------------------------------------------------------
// EventBus mock helper
// ---------------------------------------------------------------------------

function makeBus(): EventBus & { calls: AgentEvent[] } {
  const calls: AgentEvent[] = [];
  return {
    calls,
    on: vi.fn(() => () => {}),
    once: vi.fn(() => () => {}),
    onAny: vi.fn(() => () => {}),
    emit: vi.fn((event: AgentEvent) => {
      calls.push(event);
    }),
  };
}

function makeContext(overrides: Partial<GearContext> = {}): GearContext {
  return {
    input: "hello",
    proposedToolCalls: [],
    actionHistory: [],
    agentConfig: { id: "test-agent" },
    ...overrides,
  };
}

function getEventsByType(bus: ReturnType<typeof makeBus>, type: string): AgentEvent[] {
  return bus.calls.filter((e) => e.type === type);
}

// ---------------------------------------------------------------------------
// E2E Tests
// ---------------------------------------------------------------------------

describe("ManoAggregator E2E — StaticRuleArbiter (inlined)", () => {
  it("StaticRuleArbiter match → correct gear + confidence", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus);

    const arbiter = createStaticRuleArbiter({
      id: "fast-read",
      priority: 10,
      rules: [{ match: "read", gear: 1, confidence: 0.9 }],
    });

    const context = makeContext({
      input: "please read the file",
      proposedToolCalls: [],
    });

    const result = await aggregator.route(context, [arbiter]);

    expect(result.gear).toBe(1);
    expect(result.decidedBy).toBe("fast-read");
    expect(result.confidence).toBe(0.9);
    expect(result.riskAdjusted).toBe(false);
  });

  it("No matching rule → abstain → config.defaultGear", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus);

    const arbiter = createStaticRuleArbiter({
      id: "read-only-arb",
      priority: 10,
      rules: [{ match: "delete", gear: 1, confidence: 0.9 }],
    });

    const context = makeContext({
      input: "just a greeting",
      proposedToolCalls: [],
    });

    const result = await aggregator.route(context, [arbiter]);

    expect(result.gear).toBe(DEFAULT_MANO_AGGREGATOR_CONFIG.defaultGear);
    expect(result.decidedBy).toBeUndefined();
    expect(result.confidence).toBe(0);
  });

  it("confidence < adjustedThreshold → config.defaultGear", async () => {
    const bus = makeBus();
    // 'destructive' riskDelta = +0.20, so threshold = 0.6 + 0.20 = 0.80
    // confidence = 0.75 < 0.80 → should NOT pass
    const aggregator = createManoAggregator(bus);

    const arbiter = createStaticRuleArbiter({
      id: "cautious-arb",
      priority: 10,
      rules: [
        {
          match: "delete",
          gear: 1,
          confidence: 0.75,
          riskCategory: "destructive",
        },
      ],
    });

    const context = makeContext({
      input: "delete the record",
      proposedToolCalls: [{ name: "db.delete", arguments: { id: "123" } }],
    });

    const result = await aggregator.route(context, [arbiter]);

    expect(result.gear).toBe(DEFAULT_MANO_AGGREGATOR_CONFIG.defaultGear);
  });

  it("gear:switch event payload is correct on match", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus);

    const arbiter = createStaticRuleArbiter({
      id: "quick-arb",
      priority: 10,
      rules: [{ match: "search", gear: 1, confidence: 0.85 }],
    });

    const context = makeContext({ input: "search for documents" });
    await aggregator.route(context, [arbiter]);

    const switchEvents = getEventsByType(bus, "gear:switch");
    expect(switchEvents).toHaveLength(1);

    const payload = switchEvents[0].payload as {
      gear: number;
      decidedBy: string;
      confidence: number;
    };
    expect(payload.gear).toBe(1);
    expect(payload.decidedBy).toBe("quick-arb");
    expect(payload.confidence).toBe(0.85);
  });

  it("VitakkaWatchdog interaction: consecutive non-default gear triggers vitakka:stall", async () => {
    const bus = makeBus();

    // Configure watchdog: gear 1 triggers stall after 3 consecutive cycles
    const watchdog = createVitakkaWatchdog({
      maxGearDurationMs: {},
      maxConsecutiveGearCycles: { 1: 3 },
    });

    const aggregator = createManoAggregator(bus);
    const arbiter = createStaticRuleArbiter({
      id: "fast-arb",
      priority: 10,
      rules: [{ match: "fast", gear: 1, confidence: 0.9 }],
    });

    const context = makeContext({ input: "fast operation" });

    let stallTriggered = false;

    for (let i = 0; i < 3; i++) {
      const result = await aggregator.route(context, [arbiter]);
      expect(result.gear).toBe(1);

      const stalled = watchdog.recordGearCycle(result.gear);
      if (stalled) {
        stallTriggered = true;
        // Simulate what loop would do: forceNextGear to defaultGear
        aggregator.forceNextGear(DEFAULT_MANO_AGGREGATOR_CONFIG.defaultGear);
        bus.emit({
          type: "vitakka:stall",
          timestamp: Date.now(),
          payload: { gear: result.gear, cycles: i + 1 },
        });
        break;
      }
    }

    expect(stallTriggered).toBe(true);

    const stallEvents = getEventsByType(bus, "vitakka:stall");
    expect(stallEvents).toHaveLength(1);
    expect((stallEvents[0].payload as { gear: number }).gear).toBe(1);

    // Watchdog state reflects triggered
    const state = watchdog.getState();
    expect(state.triggered).toBe(true);
    expect(state.triggeredGear).toBe(1);
  });

  it("GearArbiterRegistry: register from plugin hooks and retrieve via listSorted", async () => {
    const bus = makeBus();
    const registry = createGearArbiterRegistry();
    const aggregator = createManoAggregator(bus);

    // Simulate plugin hook registration
    const highPriorityArb = createStaticRuleArbiter({
      id: "priority-1",
      priority: 5,
      rules: [{ match: "urgent", gear: 1, confidence: 0.92 }],
    });

    const lowPriorityArb = createStaticRuleArbiter({
      id: "priority-2",
      priority: 20,
      rules: [{ match: "urgent", gear: 1, confidence: 0.8 }],
    });

    // Register in reverse order to test sorting
    registry.register(lowPriorityArb);
    registry.register(highPriorityArb);

    const sorted = registry.listSorted();
    expect(sorted[0].id).toBe("priority-1"); // priority 5 comes first
    expect(sorted[1].id).toBe("priority-2"); // priority 20 comes second

    // Route using the registry
    const context = makeContext({ input: "urgent task" });
    const result = await aggregator.route(context, sorted);

    // highPriorityArb (priority=5) is evaluated first and wins
    expect(result.gear).toBe(1);
    expect(result.decidedBy).toBe("priority-1");
    expect(result.confidence).toBe(0.92);
  });

  it("GearArbiterRegistry: register replaces arbiter with same id", () => {
    const registry = createGearArbiterRegistry();

    const v1 = createStaticRuleArbiter({
      id: "shared-id",
      priority: 10,
      rules: [{ match: "x", gear: 1, confidence: 0.7 }],
    });

    const v2 = createStaticRuleArbiter({
      id: "shared-id",
      priority: 20,
      rules: [{ match: "y", gear: 2, confidence: 0.5 }],
    });

    registry.register(v1);
    registry.register(v2);

    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0].priority).toBe(20); // v2 replaced v1
  });

  it("VitakkaWatchdog: resetOnDefaultGear clears all tracking state", async () => {
    const watchdog = createVitakkaWatchdog({
      maxGearDurationMs: {},
      maxConsecutiveGearCycles: { 1: 10 },
    });

    // Record some gear 1 cycles
    watchdog.recordGearCycle(1);
    watchdog.recordGearCycle(1);

    let state = watchdog.getState();
    expect(state.consecutiveGearCycles[1]).toBe(2);

    // Reset when returning to default gear
    watchdog.resetOnDefaultGear();

    state = watchdog.getState();
    expect(state.consecutiveGearCycles[1]).toBeUndefined();
    expect(state.triggered).toBe(false);
    expect(state.triggeredGear).toBeNull();
  });

  it("StaticRuleArbiter: tool name match overrides input mismatch", async () => {
    const bus = makeBus();
    const aggregator = createManoAggregator(bus);

    const arbiter = createStaticRuleArbiter({
      id: "tool-match-arb",
      priority: 10,
      rules: [{ match: "write", gear: 1, confidence: 0.8 }],
    });

    // Input does NOT contain "write", but tool name does
    const context = makeContext({
      input: "process the data",
      proposedToolCalls: [{ name: "fs.write", arguments: { path: "/out", content: "data" } }],
    });

    const result = await aggregator.route(context, [arbiter]);

    expect(result.gear).toBe(1);
    expect(result.decidedBy).toBe("tool-match-arb");
  });
});
