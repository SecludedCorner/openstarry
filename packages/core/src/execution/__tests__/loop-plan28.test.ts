/**
 * Tests for Plan28 ExecutionLoop wiring.
 * - deliberationContext flows to deliberatePlan and deliberateAction
 * - postRouteCheck called after route()
 * - Backward compat: no volition → skip, no deliberationContext → works
 */
import { describe, it, expect, vi } from "vitest";
import { createExecutionLoop } from "../loop.js";
import type { ExecutionLoopDeps } from "../loop.js";
import type {
  AgentEvent,
  EventBus,
  IGearArbiter,
  GearContext,
  RouteResult,
  ProviderStreamEvent,
  IProvider,
  PlanDeliberationInput,
  ActionDeliberationInput,
  PlanDeliberationResult,
  ActionDeliberationResult,
  KleshaSignalBundle,
  VedanaAssessment,
  ChannelVedana,
} from "@openstarry/sdk";

// Helpers
function makeBus(): EventBus & { calls: AgentEvent[] } {
  const calls: AgentEvent[] = [];
  return {
    calls,
    on: vi.fn(() => () => {}),
    once: vi.fn(() => () => {}),
    onAny: vi.fn(() => () => {}),
    emit: vi.fn((event: AgentEvent) => { calls.push(event); }),
  };
}

function makeStateManager() {
  const messages: unknown[] = [];
  return {
    addMessage: vi.fn((msg: unknown) => { messages.push(msg); }),
    getMessages: vi.fn(() => [...messages]),
    reset: vi.fn(() => { messages.length = 0; }),
  };
}

function makeSessionManager(stateManager: ReturnType<typeof makeStateManager>) {
  return {
    getStateManager: vi.fn(() => stateManager),
    create: vi.fn(() => ({ id: "test-session" })),
    get: vi.fn(),
    destroy: vi.fn(),
    list: vi.fn(() => []),
  };
}

function makeToolThenEndProvider(toolName = "test.tool"): IProvider {
  let callCount = 0;
  return {
    skandha: "samjna" as const,
    id: "mock",
    name: "Mock",
    models: [],
    async *chat(): AsyncGenerator<ProviderStreamEvent> {
      callCount++;
      if (callCount === 1) {
        const tcId = "tc-001";
        yield { type: "tool_call_start", toolCallId: tcId, name: toolName } as any;
        yield { type: "tool_call_delta", toolCallId: tcId, input: "{}" } as any;
        yield { type: "tool_call_end", toolCallId: tcId, name: toolName, input: "{}" } as any;
        yield { type: "finish", stopReason: "tool_use", usage: { totalTokens: 10 } } as any;
      } else {
        yield { type: "text_delta", text: "Done" } as any;
        yield { type: "finish", stopReason: "end_turn", usage: { totalTokens: 5 } } as any;
      }
    },
  };
}

const neutralVedana: ChannelVedana = { valence: 0, intensity: 0, type: "upekkha", source: "test" };
const neutralKlesha: KleshaSignalBundle = { moha: 0, drishti: 0, mana: 0, sneha: 0 };
const neutralVedanaAssessment: VedanaAssessment = {
  aggregate: neutralVedana, channels: [neutralVedana], pidOutput: 0, timestamp: Date.now(),
};

function makeBaseDeps(
  bus: ReturnType<typeof makeBus>,
  stateManager: ReturnType<typeof makeStateManager>,
  provider: IProvider,
  overrides?: Partial<ExecutionLoopDeps>,
): ExecutionLoopDeps {
  return {
    bus,
    queue: { push: vi.fn(), pull: vi.fn(async () => new Promise(() => {})) } as any,
    sessionManager: makeSessionManager(stateManager) as any,
    contextManager: { assembleContext: (msgs: unknown[]) => msgs as any },
    toolRegistry: {
      get: vi.fn(() => ({
        skandha: "samskara", id: "test.tool", description: "test",
        parameters: { parse: (x: unknown) => ({ success: true, data: x }) },
        execute: vi.fn(async () => "ok"),
      })),
      register: vi.fn(), list: vi.fn(() => []), toJsonSchemas: vi.fn(() => []),
    } as any,
    security: { getAllowedPaths: vi.fn(() => ["/test"]), isPathAllowed: vi.fn(() => true) } as any,
    safetyMonitor: {
      onLoopStart: vi.fn(),
      onLoopTick: vi.fn(() => ({ halt: false })),
      beforeLLMCall: vi.fn(() => ({ halt: false })),
      afterToolExecution: vi.fn(() => ({ halt: false })),
      trackTokenUsage: vi.fn(),
      reset: vi.fn(),
      postRouteCheck: vi.fn((r: RouteResult) => r),
    } as any,
    providerResolver: () => provider,
    guideResolver: () => undefined,
    modelResolver: () => "test-model",
    maxToolRounds: 5,
    slidingWindowSize: 10,
    workingDirectory: "/test",
    toolTimeout: 30000,
    llmTimeout: 120000,
    ...overrides,
  };
}

describe("ExecutionLoop Plan28: deliberationContext wiring", () => {
  it("passes deliberationContext to deliberatePlan when routeResult exists", async () => {
    const bus = makeBus();
    const sm = makeStateManager();
    const provider = makeToolThenEndProvider();

    const deliberatePlanSpy = vi.fn(async (input: PlanDeliberationInput): Promise<PlanDeliberationResult> => {
      return { modifiedPlan: null, reasoning: "allow" };
    });

    const deliberateActionSpy = vi.fn(async (input: ActionDeliberationInput): Promise<ActionDeliberationResult> => {
      return { veto: false, alternative: null, reasoning: "allow" };
    });

    const routeResult: RouteResult = {
      gear: 1, decidedBy: "a1", confidence: 0.9, riskAdjusted: true, riskCategory: "destructive",
    };
    const manoAggregator = {
      route: vi.fn(async () => routeResult),
      forceNextGear: vi.fn(),
    };

    const deps = makeBaseDeps(bus, sm, provider, {
      manoAggregator,
      gearArbiterRegistry: { listSorted: () => [] } as any,
      volition: {
        deliberatePlan: deliberatePlanSpy,
        deliberateAction: deliberateActionSpy,
        getKleshaSignals: () => neutralKlesha,
        getVedanaAssessment: () => neutralVedanaAssessment,
      },
    });

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "hello" });

    // Verify deliberatePlan received deliberationContext
    expect(deliberatePlanSpy).toHaveBeenCalledTimes(1);
    const planInput = deliberatePlanSpy.mock.calls[0][0];
    expect(planInput.deliberationContext).toBeDefined();
    expect(planInput.deliberationContext!.routeResult).toBe(routeResult);
    expect(Array.isArray(planInput.deliberationContext!.actionHistory)).toBe(true);

    // Verify deliberateAction received deliberationContext
    expect(deliberateActionSpy).toHaveBeenCalledTimes(1);
    const actionInput = deliberateActionSpy.mock.calls[0][0];
    expect(actionInput.deliberationContext).toBeDefined();
    expect(actionInput.deliberationContext!.routeResult).toBe(routeResult);
  });

  it("deliberationContext is undefined when no manoAggregator", async () => {
    const bus = makeBus();
    const sm = makeStateManager();
    const provider = makeToolThenEndProvider();

    const deliberatePlanSpy = vi.fn(async (): Promise<PlanDeliberationResult> => {
      return { modifiedPlan: null, reasoning: "allow" };
    });

    const deps = makeBaseDeps(bus, sm, provider, {
      // No manoAggregator
      volition: {
        deliberatePlan: deliberatePlanSpy,
        deliberateAction: vi.fn(async () => ({ veto: false, alternative: null, reasoning: "allow" })),
        getKleshaSignals: () => neutralKlesha,
        getVedanaAssessment: () => neutralVedanaAssessment,
      },
    });

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "hello" });

    const planInput = deliberatePlanSpy.mock.calls[0][0];
    expect(planInput.deliberationContext).toBeUndefined();
  });
});

describe("ExecutionLoop Plan28: postRouteCheck", () => {
  it("calls postRouteCheck after route()", async () => {
    const bus = makeBus();
    const sm = makeStateManager();
    const provider = makeToolThenEndProvider();

    const routeResult: RouteResult = { gear: 1, confidence: 0.9, riskAdjusted: false };
    const postRouteCheckSpy = vi.fn((r: RouteResult) => r);

    const deps = makeBaseDeps(bus, sm, provider, {
      manoAggregator: { route: vi.fn(async () => routeResult), forceNextGear: vi.fn() },
      gearArbiterRegistry: { listSorted: () => [] } as any,
      safetyMonitor: {
        onLoopStart: vi.fn(),
        onLoopTick: vi.fn(() => ({ halt: false })),
        beforeLLMCall: vi.fn(() => ({ halt: false })),
        afterToolExecution: vi.fn(() => ({ halt: false })),
        trackTokenUsage: vi.fn(),
        reset: vi.fn(),
        postRouteCheck: postRouteCheckSpy,
      } as any,
    });

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "hello" });

    expect(postRouteCheckSpy).toHaveBeenCalledTimes(1);
    expect(postRouteCheckSpy).toHaveBeenCalledWith(routeResult);
  });
});

describe("ExecutionLoop Plan28: backward compat", () => {
  it("works without volition (skip deliberation)", async () => {
    const bus = makeBus();
    const sm = makeStateManager();
    const provider = makeToolThenEndProvider();

    const deps = makeBaseDeps(bus, sm, provider, {
      manoAggregator: {
        route: vi.fn(async () => ({ gear: 2, confidence: 0.8, riskAdjusted: false })),
        forceNextGear: vi.fn(),
      },
      gearArbiterRegistry: { listSorted: () => [] } as any,
      // No volition
    });

    const loop = createExecutionLoop(deps);
    // Should not throw
    await loop.processEvent({ source: "test", inputType: "user_input", data: "hello" });
    expect(loop.getState()).not.toBe("SAFETY_LOCKOUT");
  });
});
