/**
 * Regression tests for BUG-5: Provider errors must emit LOOP_ERROR, not LOOP_FINISHED.
 *
 * Two paths tested:
 *   Path 1 — provider stream yields an "error" event (e.g. HTTP 429/403/404)
 *   Path 2 — provider.chat() throws an exception
 */
import { describe, it, expect, vi } from "vitest";
import { createExecutionLoop } from "../loop.js";
import type { ExecutionLoopDeps } from "../loop.js";
import type { AgentEvent, EventBus, IProvider, ProviderStreamEvent } from "@openstarry/sdk";
import { AgentEventType } from "@openstarry/sdk";

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
 * Provider that yields a stream "error" event (Path 1).
 * Simulates HTTP 429/403/404 responses from a provider adapter.
 */
function makeStreamErrorProvider(statusCode: number): IProvider {
  return {
    skandha: "samjna" as const,
    id: "mock-error",
    name: "Mock Error Provider",
    models: [],
    async *chat(): AsyncGenerator<ProviderStreamEvent> {
      yield {
        type: "error",
        error: Object.assign(new Error(`HTTP ${statusCode} error from provider`), { statusCode }),
      } as unknown as ProviderStreamEvent;
    },
  };
}

/**
 * Provider whose chat() method throws synchronously (Path 2).
 */
function makeThrowingProvider(statusCode: number): IProvider {
  return {
    skandha: "samjna" as const,
    id: "mock-throw",
    name: "Mock Throwing Provider",
    models: [],
    async *chat(): AsyncGenerator<ProviderStreamEvent> {
      throw Object.assign(new Error(`HTTP ${statusCode} connection refused`), { statusCode });
    },
  };
}

function makeDeps(
  bus: ReturnType<typeof makeBus>,
  provider: IProvider,
): ExecutionLoopDeps {
  const stateManager = makeStateManager();
  const sessionManager = makeSessionManager(stateManager);

  return {
    bus,
    queue: { push: vi.fn(), pull: vi.fn() } as any,
    sessionManager: sessionManager as any,
    contextManager: { assembleContext: (msgs: unknown[]) => msgs as any },
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
    toolTimeout: 5000,
    llmTimeout: 10000,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BUG-5: Provider error event handling", () => {
  describe("Path 1 — provider stream yields error event (HTTP 429/403/404)", () => {
    it("emits LOOP_ERROR when provider stream yields error event", async () => {
      const bus = makeBus();
      const deps = makeDeps(bus, makeStreamErrorProvider(429));
      const loop = createExecutionLoop(deps);

      await loop.processEvent({
        source: "test",
        inputType: "user_input",
        data: "hello",
        sessionId: undefined,
        replyTo: undefined,
      });

      const emitted = bus.calls.map((e) => e.type);
      expect(emitted).toContain(AgentEventType.LOOP_ERROR);
    });

    it("does NOT emit LOOP_FINISHED when provider stream yields error event", async () => {
      const bus = makeBus();
      const deps = makeDeps(bus, makeStreamErrorProvider(429));
      const loop = createExecutionLoop(deps);

      await loop.processEvent({
        source: "test",
        inputType: "user_input",
        data: "hello",
        sessionId: undefined,
        replyTo: undefined,
      });

      const emitted = bus.calls.map((e) => e.type);
      expect(emitted).not.toContain(AgentEventType.LOOP_FINISHED);
    });

    it("preserves error message in LOOP_ERROR payload for HTTP 403", async () => {
      const bus = makeBus();
      const deps = makeDeps(bus, makeStreamErrorProvider(403));
      const loop = createExecutionLoop(deps);

      await loop.processEvent({
        source: "test",
        inputType: "user_input",
        data: "hello",
        sessionId: undefined,
        replyTo: undefined,
      });

      const loopErrorEvent = bus.calls.find((e) => e.type === AgentEventType.LOOP_ERROR);
      expect(loopErrorEvent).toBeDefined();
      const payload = loopErrorEvent!.payload as { error: string };
      expect(payload.error).toContain("403");
    });

    it("preserves error message in LOOP_ERROR payload for HTTP 404", async () => {
      const bus = makeBus();
      const deps = makeDeps(bus, makeStreamErrorProvider(404));
      const loop = createExecutionLoop(deps);

      await loop.processEvent({
        source: "test",
        inputType: "user_input",
        data: "hello",
        sessionId: undefined,
        replyTo: undefined,
      });

      const loopErrorEvent = bus.calls.find((e) => e.type === AgentEventType.LOOP_ERROR);
      expect(loopErrorEvent).toBeDefined();
      const payload = loopErrorEvent!.payload as { error: string };
      expect(payload.error).toContain("404");
    });
  });

  describe("Path 2 — provider.chat() throws an exception", () => {
    it("emits LOOP_ERROR when provider throws", async () => {
      const bus = makeBus();
      const deps = makeDeps(bus, makeThrowingProvider(429));
      const loop = createExecutionLoop(deps);

      await loop.processEvent({
        source: "test",
        inputType: "user_input",
        data: "hello",
        sessionId: undefined,
        replyTo: undefined,
      });

      const emitted = bus.calls.map((e) => e.type);
      expect(emitted).toContain(AgentEventType.LOOP_ERROR);
    });

    it("does NOT emit LOOP_FINISHED when provider throws", async () => {
      const bus = makeBus();
      const deps = makeDeps(bus, makeThrowingProvider(429));
      const loop = createExecutionLoop(deps);

      await loop.processEvent({
        source: "test",
        inputType: "user_input",
        data: "hello",
        sessionId: undefined,
        replyTo: undefined,
      });

      const emitted = bus.calls.map((e) => e.type);
      expect(emitted).not.toContain(AgentEventType.LOOP_FINISHED);
    });

    it("preserves error message in LOOP_ERROR payload when provider throws", async () => {
      const bus = makeBus();
      const deps = makeDeps(bus, makeThrowingProvider(429));
      const loop = createExecutionLoop(deps);

      await loop.processEvent({
        source: "test",
        inputType: "user_input",
        data: "hello",
        sessionId: undefined,
        replyTo: undefined,
      });

      const loopErrorEvent = bus.calls.find((e) => e.type === AgentEventType.LOOP_ERROR);
      expect(loopErrorEvent).toBeDefined();
      const payload = loopErrorEvent!.payload as { error: string };
      expect(payload.error).toContain("429");
    });
  });

  describe("Regression: normal completion still emits LOOP_FINISHED", () => {
    it("emits LOOP_FINISHED (not LOOP_ERROR) on successful completion", async () => {
      const bus = makeBus();
      const successProvider: IProvider = {
        skandha: "samjna" as const,
        id: "mock-success",
        name: "Mock Success Provider",
        models: [],
        async *chat(): AsyncGenerator<ProviderStreamEvent> {
          yield { type: "text_delta", text: "Hello!" } as ProviderStreamEvent;
          yield {
            type: "finish",
            stopReason: "end_turn",
            usage: { totalTokens: 5 },
          } as unknown as ProviderStreamEvent;
        },
      };
      const deps = makeDeps(bus, successProvider);
      const loop = createExecutionLoop(deps);

      await loop.processEvent({
        source: "test",
        inputType: "user_input",
        data: "hello",
        sessionId: undefined,
        replyTo: undefined,
      });

      const emitted = bus.calls.map((e) => e.type);
      expect(emitted).toContain(AgentEventType.LOOP_FINISHED);
      expect(emitted).not.toContain(AgentEventType.LOOP_ERROR);
    });
  });
});
