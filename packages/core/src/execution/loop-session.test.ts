import { describe, it, expect, vi } from "vitest";
import { createExecutionLoop } from "./loop.js";
import type { ExecutionLoopDeps } from "./loop.js";
import { createSessionManager } from "../session/manager.js";
import { createEventBus } from "../bus/index.js";
import { createEventQueue } from "./queue.js";
import type { AgentEvent, ChatRequest, IProvider, ProviderStreamEvent } from "@openstarry/sdk";
import { AgentEventType } from "@openstarry/sdk";

function createMockProvider(text: string): IProvider {
  return {
    skandha: "samjna" as const,
    id: "mock",
    name: "Mock Provider",
    models: [],
    async *chat(): AsyncGenerator<ProviderStreamEvent> {
      yield { type: "text_delta", text } as ProviderStreamEvent;
      yield {
        type: "finish",
        stopReason: "end_turn",
        usage: { totalTokens: 10 },
      } as unknown as ProviderStreamEvent;
    },
  };
}

function createTestDeps(overrides?: Partial<ExecutionLoopDeps>): ExecutionLoopDeps {
  const bus = createEventBus();
  const queue = createEventQueue();
  const sessionManager = createSessionManager(bus);

  return {
    bus,
    queue,
    sessionManager,
    contextManager: {
      assembleContext: (msgs, _max) => msgs,
    },
    toolRegistry: {
      get: () => undefined,
      register: vi.fn(),
      list: () => [],
      toJsonSchemas: () => [],
    } as any,
    security: {
      getAllowedPaths: () => ["/test"],
      isPathAllowed: () => true,
    } as any,
    safetyMonitor: {
      onLoopStart: vi.fn(),
      onLoopTick: vi.fn(() => ({ halt: false })),
      beforeLLMCall: vi.fn(() => ({ halt: false })),
      afterToolExecution: vi.fn(() => ({ halt: false })),
      trackTokenUsage: vi.fn(),
      reset: vi.fn(),
    } as any,
    providerResolver: (_sessionId?: string) => createMockProvider("Hello"),
    guideResolver: () => undefined,
    modelResolver: (_sessionId?: string) => "test-model",
    maxToolRounds: 5,
    slidingWindowSize: 10,
    workingDirectory: "/test",
    toolTimeout: 30000,
    llmTimeout: 120000,
    ...overrides,
  };
}

describe("ExecutionLoop session integration", () => {
  it("uses session-specific state manager", async () => {
    const deps = createTestDeps();
    const loop = createExecutionLoop(deps);

    const session = deps.sessionManager.create();

    await loop.processEvent({
      source: "test",
      inputType: "user_input",
      data: "hello",
      sessionId: session.id,
    });

    // Session state should have user + assistant messages
    const sessionSm = deps.sessionManager.getStateManager(session.id);
    const msgs = sessionSm.getMessages();
    expect(msgs.length).toBeGreaterThanOrEqual(2); // user + assistant

    // Default session should be empty
    const defaultSm = deps.sessionManager.getStateManager(undefined);
    expect(defaultSm.getMessages()).toHaveLength(0);
  });

  it("falls back to default session when no sessionId", async () => {
    const deps = createTestDeps();
    const loop = createExecutionLoop(deps);

    await loop.processEvent({
      source: "test",
      inputType: "user_input",
      data: "hello",
    });

    // Default session should have messages
    const defaultSm = deps.sessionManager.getStateManager(undefined);
    expect(defaultSm.getMessages().length).toBeGreaterThanOrEqual(2);
  });

  it("emits events with sessionId in payload", async () => {
    const deps = createTestDeps();
    const emitted: AgentEvent[] = [];
    deps.bus.onAny((e) => emitted.push(e));

    const loop = createExecutionLoop(deps);
    const session = deps.sessionManager.create();

    await loop.processEvent({
      source: "test",
      inputType: "user_input",
      data: "hello",
      sessionId: session.id,
      replyTo: "client-1",
    });

    // Check LOOP_STARTED has sessionId
    const loopStarted = emitted.find((e) => e.type === AgentEventType.LOOP_STARTED);
    expect(loopStarted).toBeDefined();
    const startPayload = loopStarted!.payload as Record<string, unknown>;
    expect(startPayload.sessionId).toBe(session.id);
    expect(startPayload.replyTo).toBe("client-1");

    // Check LOOP_FINISHED has sessionId
    const loopFinished = emitted.find((e) => e.type === AgentEventType.LOOP_FINISHED);
    expect(loopFinished).toBeDefined();
    const finishPayload = loopFinished!.payload as Record<string, unknown>;
    expect(finishPayload.sessionId).toBe(session.id);
    expect(finishPayload.replyTo).toBe("client-1");

    // Check MESSAGE_ASSISTANT has sessionId
    const msgAssistant = emitted.find((e) => e.type === AgentEventType.MESSAGE_ASSISTANT);
    expect(msgAssistant).toBeDefined();
    const assistPayload = msgAssistant!.payload as Record<string, unknown>;
    expect(assistPayload.sessionId).toBe(session.id);
  });

  it("two concurrent sessions maintain independent histories", async () => {
    const deps = createTestDeps({
      providerResolver: (_sessionId?: string) => createMockProvider("Response"),
    });
    const loop = createExecutionLoop(deps);

    const s1 = deps.sessionManager.create();
    const s2 = deps.sessionManager.create();

    await loop.processEvent({
      source: "test",
      inputType: "user_input",
      data: "Message for session 1",
      sessionId: s1.id,
    });

    await loop.processEvent({
      source: "test",
      inputType: "user_input",
      data: "Message for session 2",
      sessionId: s2.id,
    });

    const sm1 = deps.sessionManager.getStateManager(s1.id);
    const sm2 = deps.sessionManager.getStateManager(s2.id);

    // Each session has its own independent history (user + assistant)
    expect(sm1.getMessages()).toHaveLength(2);
    expect(sm2.getMessages()).toHaveLength(2);

    // Verify content is session-specific
    const s1UserMsg = sm1.getMessages()[0];
    const s2UserMsg = sm2.getMessages()[0];
    expect((s1UserMsg.content[0] as any).text).toBe("Message for session 1");
    expect((s2UserMsg.content[0] as any).text).toBe("Message for session 2");
  });
});

describe("ExecutionLoop LLM timeout", () => {
  it("passes AbortSignal to ChatRequest", async () => {
    let capturedRequest: ChatRequest | undefined;

    const capturingProvider: IProvider = {
      skandha: "samjna" as const,
      id: "capture",
      name: "Capture Provider",
      models: [],
      async *chat(req: ChatRequest): AsyncGenerator<ProviderStreamEvent> {
        capturedRequest = req;
        yield { type: "text_delta", text: "ok" } as ProviderStreamEvent;
        yield {
          type: "finish",
          stopReason: "end_turn",
          usage: { totalTokens: 5 },
        } as unknown as ProviderStreamEvent;
      },
    };

    const deps = createTestDeps({
      providerResolver: () => capturingProvider,
    });
    const loop = createExecutionLoop(deps);

    await loop.processEvent({
      source: "test",
      inputType: "user_input",
      data: "hello",
    });

    expect(capturedRequest).toBeDefined();
    expect(capturedRequest!.signal).toBeInstanceOf(AbortSignal);
    expect(capturedRequest!.signal!.aborted).toBe(false);
  });

  it("aborts LLM call when timeout expires", async () => {
    vi.useFakeTimers();

    let capturedSignal: AbortSignal | undefined;

    const slowProvider: IProvider = {
      skandha: "samjna" as const,
      id: "slow",
      name: "Slow Provider",
      models: [],
      async *chat(req: ChatRequest): AsyncGenerator<ProviderStreamEvent> {
        capturedSignal = req.signal;
        // Simulate a slow provider: wait for a long time
        await new Promise((_resolve, reject) => {
          if (req.signal) {
            req.signal.addEventListener("abort", () => {
              reject(req.signal!.reason);
            });
          }
        });
      },
    };

    const deps = createTestDeps({
      providerResolver: () => slowProvider,
      llmTimeout: 5000,
    });
    const emitted: AgentEvent[] = [];
    deps.bus.onAny((e) => emitted.push(e));

    const loop = createExecutionLoop(deps);

    const processPromise = loop.processEvent({
      source: "test",
      inputType: "user_input",
      data: "hello",
    });

    // Advance time past the timeout
    await vi.advanceTimersByTimeAsync(6000);
    await processPromise;

    // The signal should have been aborted
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(true);

    // Should have emitted LOOP_ERROR
    const loopError = emitted.find((e) => e.type === AgentEventType.LOOP_ERROR);
    expect(loopError).toBeDefined();
    const errorPayload = loopError!.payload as Record<string, unknown>;
    expect(errorPayload.error).toContain("timed out");

    vi.useRealTimers();
  });

  it("uses 120000ms timeout from resolved config", async () => {
    let capturedRequest: ChatRequest | undefined;

    const capturingProvider: IProvider = {
      skandha: "samjna" as const,
      id: "capture",
      name: "Capture Provider",
      models: [],
      async *chat(req: ChatRequest): AsyncGenerator<ProviderStreamEvent> {
        capturedRequest = req;
        yield { type: "text_delta", text: "ok" } as ProviderStreamEvent;
        yield {
          type: "finish",
          stopReason: "end_turn",
          usage: { totalTokens: 5 },
        } as unknown as ProviderStreamEvent;
      },
    };

    // llmTimeout resolved from SDK default (120000ms)
    const deps = createTestDeps({
      providerResolver: () => capturingProvider,
    });
    const loop = createExecutionLoop(deps);

    await loop.processEvent({
      source: "test",
      inputType: "user_input",
      data: "hello",
    });

    expect(capturedRequest).toBeDefined();
    expect(capturedRequest!.signal).toBeInstanceOf(AbortSignal);
    // Signal should NOT be aborted (fast response, 120s timeout)
    expect(capturedRequest!.signal!.aborted).toBe(false);
  });
});
