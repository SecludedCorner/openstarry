import { describe, it, expect, vi } from "vitest";
import { createExecutionLoop } from "./loop.js";
import type { ExecutionLoopDeps } from "./loop.js";
import { createSessionManager } from "../session/manager.js";
import { createEventBus } from "../bus/index.js";
import { createEventQueue } from "./queue.js";
import type { AgentEvent, IProvider, ProviderStreamEvent } from "@openstarry/sdk";
import { AgentEventType } from "@openstarry/sdk";

function createMockProvider(text: string): IProvider {
  return {
    id: "mock",
    name: "Mock Provider",
    async *chat(): AsyncGenerator<ProviderStreamEvent> {
      yield { type: "text_delta", text } as ProviderStreamEvent;
      yield {
        type: "finish",
        stopReason: "end_turn",
        usage: { totalTokens: 10 },
      } as unknown as ProviderStreamEvent;
    },
    listModels: async () => [],
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
