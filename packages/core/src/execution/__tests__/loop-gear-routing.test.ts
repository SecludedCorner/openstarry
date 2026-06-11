/**
 * Tests for Phase 2.5 gear routing integration in ExecutionLoop.
 * @see execution/loop.ts (Phase 2.5: ManoAggregator routing)
 * @see Plan27b
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
} from "@openstarry/sdk";

// ---------------------------------------------------------------------------
// Helpers
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

/**
 * Provider that yields a single tool_use response ONCE, then end_turn on
 * the second call. This models realistic loop behavior: first LLM call
 * proposes a tool, second LLM call (after tool result) ends the turn.
 */
function makeToolThenEndProvider(toolName = "test.tool"): IProvider {
  let callCount = 0;
  return {
    skandha: "samjna" as const,
    id: "mock-tool-then-end",
    name: "Mock Tool-Then-End Provider",
    models: [],
    async *chat(): AsyncGenerator<ProviderStreamEvent> {
      callCount++;
      if (callCount === 1) {
        // First call: propose a tool
        const toolCallId = "tc-001";
        yield { type: "tool_call_start", toolCallId, name: toolName } as unknown as ProviderStreamEvent;
        yield { type: "tool_call_delta", toolCallId, input: "{}" } as unknown as ProviderStreamEvent;
        yield { type: "tool_call_end", toolCallId, name: toolName, input: "{}" } as unknown as ProviderStreamEvent;
        yield { type: "finish", stopReason: "tool_use", usage: { totalTokens: 20 } } as unknown as ProviderStreamEvent;
      } else {
        // Subsequent calls: plain text end_turn
        yield { type: "text_delta", text: "Done." } as ProviderStreamEvent;
        yield { type: "finish", stopReason: "end_turn", usage: { totalTokens: 5 } } as unknown as ProviderStreamEvent;
      }
    },
  };
}

/** Provider that yields a plain text response only (end_turn, no tools). */
function makeTextProvider(text = "Hello"): IProvider {
  return {
    skandha: "samjna" as const,
    id: "mock-text",
    name: "Mock Text Provider",
    models: [],
    async *chat(): AsyncGenerator<ProviderStreamEvent> {
      yield { type: "text_delta", text } as ProviderStreamEvent;
      yield { type: "finish", stopReason: "end_turn", usage: { totalTokens: 10 } } as unknown as ProviderStreamEvent;
    },
  };
}

function makeBaseDeps(
  bus: ReturnType<typeof makeBus>,
  stateManager: ReturnType<typeof makeStateManager>,
  provider: IProvider,
  overrides?: Partial<ExecutionLoopDeps>,
): ExecutionLoopDeps {
  const sessionManager = makeSessionManager(stateManager);

  return {
    bus,
    queue: {
      push: vi.fn(),
      pull: vi.fn(async () => new Promise(() => {})),
    } as any,
    sessionManager: sessionManager as any,
    contextManager: {
      assembleContext: (msgs: unknown[]) => msgs as any,
    },
    toolRegistry: {
      get: vi.fn(() => undefined),
      register: vi.fn(),
      list: vi.fn(() => []),
      toJsonSchemas: vi.fn(() => []),
    } as any,
    security: {
      getAllowedPaths: vi.fn(() => ["/test"]),
      isPathAllowed: vi.fn(() => true),
    } as any,
    safetyMonitor: {
      onLoopStart: vi.fn(),
      onLoopTick: vi.fn(() => ({ halt: false })),
      beforeLLMCall: vi.fn(() => ({ halt: false })),
      afterToolExecution: vi.fn(() => ({ halt: false })),
      trackTokenUsage: vi.fn(),
      reset: vi.fn(),
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

function getEmittedTypes(bus: ReturnType<typeof makeBus>): string[] {
  return bus.calls.map((e) => e.type);
}

function getEventsByType(bus: ReturnType<typeof makeBus>, type: string): AgentEvent[] {
  return bus.calls.filter((e) => e.type === type);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExecutionLoop — Phase 2.5 gear routing (Plan27b)", () => {
  it("no manoAggregator: skips Phase 2.5 entirely, no gear:switch emitted", async () => {
    const bus = makeBus();
    const sm = makeStateManager();
    const deps = makeBaseDeps(bus, sm, makeToolThenEndProvider());

    const loop = createExecutionLoop(deps);
    await loop.processEvent({
      source: "test",
      inputType: "user_input",
      data: "run tool",
    });

    const types = getEmittedTypes(bus);
    expect(types).not.toContain("gear:switch");
  });

  it("manoAggregator present but no arbiters: route() called with empty array, returns defaultGear", async () => {
    const bus = makeBus();
    const sm = makeStateManager();

    const mockAggregator = {
      route: vi.fn(async (): Promise<RouteResult> => ({
        gear: 2,
        confidence: 0,
        riskAdjusted: false,
      })),
      forceNextGear: vi.fn(),
    };

    const mockRegistry = {
      listSorted: vi.fn((): IGearArbiter[] => []),
    };

    // maxToolRounds: 1 ensures exactly one tool round so route is called exactly once
    const deps = makeBaseDeps(bus, sm, makeToolThenEndProvider(), {
      manoAggregator: mockAggregator,
      gearArbiterRegistry: mockRegistry,
      maxToolRounds: 1,
    });

    const loop = createExecutionLoop(deps);
    await loop.processEvent({
      source: "test",
      inputType: "user_input",
      data: "run tool",
    });

    expect(mockAggregator.route).toHaveBeenCalledOnce();
    expect(mockRegistry.listSorted).toHaveBeenCalledOnce();

    const [gearContext, arbitersArg] = mockAggregator.route.mock.calls[0] as [GearContext, IGearArbiter[]];
    expect(gearContext.input).toBe("run tool");
    expect(gearContext.proposedToolCalls).toHaveLength(1);
    expect(gearContext.proposedToolCalls[0].name).toBe("test.tool");
    expect(arbitersArg).toEqual([]);
  });

  it("arbiter matches → gear 1 route: manoAggregator returns gear 1, context contains tool call", async () => {
    const bus = makeBus();
    const sm = makeStateManager();

    const mockAggregator = {
      route: vi.fn(async (): Promise<RouteResult> => ({
        gear: 1,
        decidedBy: "fast-arbiter",
        confidence: 0.9,
        riskAdjusted: false,
      })),
      forceNextGear: vi.fn(),
    };

    const fastArbiter: IGearArbiter = {
      id: "fast-arbiter",
      priority: 10,
      evaluate: () => ({ action: 1, confidence: 0.9 }),
    };

    const mockRegistry = {
      listSorted: vi.fn((): IGearArbiter[] => [fastArbiter]),
    };

    const deps = makeBaseDeps(bus, sm, makeToolThenEndProvider("my.tool"), {
      manoAggregator: mockAggregator,
      gearArbiterRegistry: mockRegistry,
      maxToolRounds: 1,
    });

    const loop = createExecutionLoop(deps);
    await loop.processEvent({
      source: "test",
      inputType: "user_input",
      data: "fast request",
    });

    expect(mockAggregator.route).toHaveBeenCalledOnce();
    const [contextArg, arbitersArg] = mockAggregator.route.mock.calls[0] as [GearContext, IGearArbiter[]];
    expect(arbitersArg).toHaveLength(1);
    expect(arbitersArg[0].id).toBe("fast-arbiter");
    expect(contextArg.input).toBe("fast request");
    expect(contextArg.proposedToolCalls[0].name).toBe("my.tool");
  });

  it("gear:switch event is emitted when manoAggregator emits it via bus", async () => {
    // The real ManoAggregator emits gear:switch on its bus reference.
    // This test simulates that and verifies the bus is the shared loop bus.
    const bus = makeBus();
    const sm = makeStateManager();

    const mockAggregator = {
      route: vi.fn(async (): Promise<RouteResult> => {
        // Simulate what real ManoAggregator does: emit gear:switch on bus
        bus.emit({ type: "gear:switch", timestamp: Date.now(), payload: { gear: 1, decidedBy: "arb" } });
        return { gear: 1, decidedBy: "arb", confidence: 0.85, riskAdjusted: false };
      }),
      forceNextGear: vi.fn(),
    };

    const mockRegistry = { listSorted: vi.fn((): IGearArbiter[] => []) };

    const deps = makeBaseDeps(bus, sm, makeToolThenEndProvider(), {
      manoAggregator: mockAggregator,
      gearArbiterRegistry: mockRegistry,
      maxToolRounds: 1,
    });

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "go" });

    const gearSwitchEvents = getEventsByType(bus, "gear:switch");
    expect(gearSwitchEvents).toHaveLength(1);
    expect((gearSwitchEvents[0].payload as { gear: number }).gear).toBe(1);
  });

  it("action:proposed is emitted before tool execution with current gear", async () => {
    const bus = makeBus();
    const sm = makeStateManager();

    const mockAggregator = {
      route: vi.fn(async (): Promise<RouteResult> => ({
        gear: 1,
        decidedBy: "fast-arb",
        confidence: 0.9,
        riskAdjusted: false,
      })),
      forceNextGear: vi.fn(),
    };

    const mockRegistry = { listSorted: vi.fn((): IGearArbiter[] => []) };

    const deps = makeBaseDeps(bus, sm, makeToolThenEndProvider("my.tool"), {
      manoAggregator: mockAggregator,
      gearArbiterRegistry: mockRegistry,
      maxToolRounds: 1,
    });

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "action" });

    const proposed = getEventsByType(bus, "action:proposed");
    expect(proposed).toHaveLength(1);
    const payload = proposed[0].payload as { gear: number; action: { name: string } };
    expect(payload.gear).toBe(1);
    expect(payload.action.name).toBe("my.tool");
  });

  it("action:executed is emitted after tool execution with current gear", async () => {
    const bus = makeBus();
    const sm = makeStateManager();

    const mockAggregator = {
      route: vi.fn(async (): Promise<RouteResult> => ({
        gear: 2,
        confidence: 0,
        riskAdjusted: false,
      })),
      forceNextGear: vi.fn(),
    };

    const mockRegistry = { listSorted: vi.fn((): IGearArbiter[] => []) };

    const deps = makeBaseDeps(bus, sm, makeToolThenEndProvider("calc.add"), {
      manoAggregator: mockAggregator,
      gearArbiterRegistry: mockRegistry,
      maxToolRounds: 1,
    });

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "calculate" });

    const executed = getEventsByType(bus, "action:executed");
    expect(executed).toHaveLength(1);
    const payload = executed[0].payload as { gear: number; success: boolean };
    expect(payload.gear).toBe(2);
    expect(typeof payload.success).toBe("boolean");
  });

  it("sparsha:contact event is emitted at processEvent entry", async () => {
    const bus = makeBus();
    const sm = makeStateManager();
    const deps = makeBaseDeps(bus, sm, makeTextProvider());

    const loop = createExecutionLoop(deps);
    await loop.processEvent({
      source: "cli",
      inputType: "user_input",
      data: "hello world",
    });

    const sparshEvents = getEventsByType(bus, "sparsha:contact");
    expect(sparshEvents).toHaveLength(1);
    const payload = sparshEvents[0].payload as { sparshEvent: { root: string; consciousness: string } };
    expect(payload.sparshEvent.root).toBe("cli");
    expect(payload.sparshEvent.consciousness).toBe("mano-vijnana");
  });

  it("sparsha:contact is emitted in the same processEvent cycle as loop:started", async () => {
    // Per loop.ts: order is MESSAGE_USER → LOOP_STARTED → sparsha:contact
    const bus = makeBus();
    const sm = makeStateManager();
    const deps = makeBaseDeps(bus, sm, makeTextProvider());

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "order check" });

    const types = getEmittedTypes(bus);
    const sparshIdx = types.indexOf("sparsha:contact");
    const loopStartedIdx = types.indexOf("loop:started");

    expect(sparshIdx).toBeGreaterThanOrEqual(0);
    expect(loopStartedIdx).toBeGreaterThanOrEqual(0);

    // Both events appear in the same processEvent call
    // Per loop.ts: LOOP_STARTED emitted first, then sparsha:contact
    expect(loopStartedIdx).toBeLessThan(sparshIdx);
  });

  it("routeResult gear propagates to action:proposed payload", async () => {
    const bus = makeBus();
    const sm = makeStateManager();

    // Gear 3 (future deep reasoning)
    const mockAggregator = {
      route: vi.fn(async (): Promise<RouteResult> => ({
        gear: 3,
        decidedBy: "deep-arb",
        confidence: 0.95,
        riskAdjusted: false,
      })),
      forceNextGear: vi.fn(),
    };

    const mockRegistry = { listSorted: vi.fn((): IGearArbiter[] => []) };

    const deps = makeBaseDeps(bus, sm, makeToolThenEndProvider("deep.analyze"), {
      manoAggregator: mockAggregator,
      gearArbiterRegistry: mockRegistry,
      maxToolRounds: 1,
    });

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "deep analysis" });

    const proposed = getEventsByType(bus, "action:proposed");
    expect(proposed).toHaveLength(1);
    expect((proposed[0].payload as { gear: number }).gear).toBe(3);
  });

  it("manoAggregator is not called when stopReason is end_turn (no tool calls)", async () => {
    const bus = makeBus();
    const sm = makeStateManager();

    const mockAggregator = {
      route: vi.fn(async (): Promise<RouteResult> => ({
        gear: 2,
        confidence: 0,
        riskAdjusted: false,
      })),
      forceNextGear: vi.fn(),
    };

    const mockRegistry = { listSorted: vi.fn((): IGearArbiter[] => []) };

    // Text-only provider — no tool calls, stop reason = end_turn
    const deps = makeBaseDeps(bus, sm, makeTextProvider(), {
      manoAggregator: mockAggregator,
      gearArbiterRegistry: mockRegistry,
    });

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "just text" });

    // Phase 2.5 only runs when stopReason === "tool_use" && pendingToolCalls.length > 0
    expect(mockAggregator.route).not.toHaveBeenCalled();
  });

  it("gearArbiterRegistry absent: manoAggregator called with empty arbiters array", async () => {
    const bus = makeBus();
    const sm = makeStateManager();

    const mockAggregator = {
      route: vi.fn(async (): Promise<RouteResult> => ({
        gear: 2,
        confidence: 0,
        riskAdjusted: false,
      })),
      forceNextGear: vi.fn(),
    };

    // No gearArbiterRegistry provided, maxToolRounds: 1 for one routing call
    const deps = makeBaseDeps(bus, sm, makeToolThenEndProvider(), {
      manoAggregator: mockAggregator,
      gearArbiterRegistry: undefined,
      maxToolRounds: 1,
    });

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "no registry" });

    expect(mockAggregator.route).toHaveBeenCalledOnce();
    const arbitersArg = mockAggregator.route.mock.calls[0][1] as IGearArbiter[];
    expect(arbitersArg).toEqual([]);
  });
});
