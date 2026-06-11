/**
 * Tests for Plan37 C2 (per-tool audit events) and C4 (must-invoke verification).
 * - C2: batch of N tools emits N audit:tool_audited events
 * - C4: auditEventCount equals toolResults.length
 * - AuditTrailWriter: receives audit:tool_audited events
 */
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createExecutionLoop } from "../loop.js";
import type { ExecutionLoopDeps } from "../loop.js";
import type {
  AgentEvent,
  EventBus,
  ProviderStreamEvent,
  IProvider,
} from "@openstarry/sdk";
import { createAuditTrailWriter } from "../../observability/audit-trail-writer.js";

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

/**
 * Provider that yields N tool calls in one response, then end_turn on second call.
 */
function makeMultiToolProvider(toolNames: string[]): IProvider {
  let callCount = 0;
  return {
    skandha: "samjna" as const,
    id: "mock",
    name: "Mock",
    models: [],
    async *chat(): AsyncGenerator<ProviderStreamEvent> {
      callCount++;
      if (callCount === 1) {
        for (const name of toolNames) {
          const tcId = `tc-${name}`;
          yield { type: "tool_call_start", toolCallId: tcId, name } as any;
          yield { type: "tool_call_delta", toolCallId: tcId, input: "{}" } as any;
          yield { type: "tool_call_end", toolCallId: tcId, name, input: "{}" } as any;
        }
        yield { type: "finish", stopReason: "tool_use", usage: { totalTokens: 10 } } as any;
      } else {
        yield { type: "text_delta", text: "Done" } as any;
        yield { type: "finish", stopReason: "end_turn", usage: { totalTokens: 5 } } as any;
      }
    },
  };
}

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
      get: vi.fn((name: string) => ({
        skandha: "samskara", id: name, description: "test",
        parameters: z.object({}).passthrough(),
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
      postRouteCheck: vi.fn((r: unknown) => r),
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

// ---------------------------------------------------------------------------
// C2: Per-tool audit events
// ---------------------------------------------------------------------------

describe("Plan37 C2: per-tool audit events", () => {
  it("emits one audit:tool_audited event per tool in a single-tool batch", async () => {
    const bus = makeBus();
    const sm = makeStateManager();
    const provider = makeMultiToolProvider(["tool.alpha"]);
    const deps = makeBaseDeps(bus, sm, provider);

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "hello" });

    const auditEvents = bus.calls.filter(e => e.type === "audit:tool_audited");
    expect(auditEvents).toHaveLength(1);
  });

  it("emits 3 audit:tool_audited events for a batch of 3 tools", async () => {
    const bus = makeBus();
    const sm = makeStateManager();
    const provider = makeMultiToolProvider(["tool.alpha", "tool.beta", "tool.gamma"]);
    const deps = makeBaseDeps(bus, sm, provider);

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "hello" });

    const auditEvents = bus.calls.filter(e => e.type === "audit:tool_audited");
    expect(auditEvents).toHaveLength(3);
  });

  it("each event contains correct toolName", async () => {
    const bus = makeBus();
    const sm = makeStateManager();
    const toolNames = ["tool.alpha", "tool.beta", "tool.gamma"];
    const provider = makeMultiToolProvider(toolNames);
    const deps = makeBaseDeps(bus, sm, provider);

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "hello" });

    const auditEvents = bus.calls.filter(e => e.type === "audit:tool_audited");
    const emittedNames = auditEvents.map(e => (e.payload as any).toolName);
    expect(emittedNames).toEqual(toolNames);
  });

  it("each event contains batchIndex and batchSize", async () => {
    const bus = makeBus();
    const sm = makeStateManager();
    const toolNames = ["tool.alpha", "tool.beta", "tool.gamma"];
    const provider = makeMultiToolProvider(toolNames);
    const deps = makeBaseDeps(bus, sm, provider);

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "hello" });

    const auditEvents = bus.calls.filter(e => e.type === "audit:tool_audited");
    expect(auditEvents).toHaveLength(3);

    for (let i = 0; i < 3; i++) {
      const payload = auditEvents[i].payload as any;
      expect(payload.batchIndex).toBe(i);
      expect(payload.batchSize).toBe(3);
    }
  });

  it("each event contains inferredRiskCategory (non-empty string)", async () => {
    const bus = makeBus();
    const sm = makeStateManager();
    const provider = makeMultiToolProvider(["tool.alpha"]);
    const deps = makeBaseDeps(bus, sm, provider);

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "hello" });

    const auditEvents = bus.calls.filter(e => e.type === "audit:tool_audited");
    expect(auditEvents).toHaveLength(1);
    const payload = auditEvents[0].payload as any;
    expect(typeof payload.inferredRiskCategory).toBe("string");
    expect(payload.inferredRiskCategory.length).toBeGreaterThan(0);
  });

  it("executionResult is 'success' for a successful tool", async () => {
    const bus = makeBus();
    const sm = makeStateManager();
    const provider = makeMultiToolProvider(["tool.alpha"]);
    const deps = makeBaseDeps(bus, sm, provider);

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "hello" });

    const auditEvents = bus.calls.filter(e => e.type === "audit:tool_audited");
    expect((auditEvents[0].payload as any).executionResult).toBe("success");
  });

  it("executionResult is 'error' when tool throws", async () => {
    const bus = makeBus();
    const sm = makeStateManager();
    const provider = makeMultiToolProvider(["tool.fails"]);

    const failingToolRegistry = {
      get: vi.fn((name: string) => ({
        skandha: "samskara", id: name, description: "failing tool",
        parameters: z.object({}).passthrough(),
        execute: vi.fn(async () => { throw new Error("tool error"); }),
      })),
      register: vi.fn(), list: vi.fn(() => []), toJsonSchemas: vi.fn(() => []),
    } as any;

    const deps = makeBaseDeps(bus, sm, provider, { toolRegistry: failingToolRegistry });

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "hello" });

    const auditEvents = bus.calls.filter(e => e.type === "audit:tool_audited");
    expect(auditEvents).toHaveLength(1);
    expect((auditEvents[0].payload as any).executionResult).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// C4: Must-invoke audit count verification
// ---------------------------------------------------------------------------

describe("Plan37 C4: must-invoke audit count", () => {
  it("auditEventCount equals toolResults.length for a 3-tool batch", async () => {
    const bus = makeBus();
    const sm = makeStateManager();
    const toolNames = ["tool.alpha", "tool.beta", "tool.gamma"];
    const provider = makeMultiToolProvider(toolNames);
    const deps = makeBaseDeps(bus, sm, provider);

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "hello" });

    // Structural guarantee: one audit:tool_audited per tool result
    const auditEvents = bus.calls.filter(e => e.type === "audit:tool_audited");
    const toolResultMessages = bus.calls.filter(
      e => e.type === "action:executed"
    );
    expect(auditEvents).toHaveLength(toolResultMessages.length);
  });

  it("no audit gap logged for normal execution (no logger.warn for must-invoke)", async () => {
    // We verify indirectly: 1 tool => 1 audit event, counts match
    const bus = makeBus();
    const sm = makeStateManager();
    const provider = makeMultiToolProvider(["tool.alpha"]);
    const deps = makeBaseDeps(bus, sm, provider);

    const loop = createExecutionLoop(deps);
    await loop.processEvent({ source: "test", inputType: "user_input", data: "hello" });

    const auditEvents = bus.calls.filter(e => e.type === "audit:tool_audited");
    expect(auditEvents).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AuditTrailWriter: receives audit:tool_audited events
// ---------------------------------------------------------------------------

describe("AuditTrailWriter: audit:tool_audited subscription", () => {
  it("subscribes to both audit:completed and audit:tool_audited on start()", () => {
    // Verify the bus.on is called for both event types when writer starts
    const handlers: Array<{ type: string; handler: (event: AgentEvent) => void }> = [];
    const bus: EventBus = {
      emit: vi.fn(),
      on: vi.fn((type: string, handler: (event: AgentEvent) => void) => {
        handlers.push({ type, handler });
        return () => {
          const idx = handlers.findIndex(h => h.handler === handler);
          if (idx >= 0) handlers.splice(idx, 1);
        };
      }),
      once: vi.fn(() => () => {}),
      onAny: vi.fn(() => () => {}),
    };

    const writer = createAuditTrailWriter(bus, "test-agent", { filePath: "/dev/null" });
    writer.start();

    const subscribedTypes = handlers.map(h => h.type);
    expect(subscribedTypes).toContain("audit:completed");
    expect(subscribedTypes).toContain("audit:tool_audited");
  });
});
