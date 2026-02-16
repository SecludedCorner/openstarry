import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { attachRpcHandler, type RpcHandlerDeps } from "../rpc-handler.js";
import type { EventBus, AgentEvent, InputEvent, ISessionManager, ITool, IGuide, ISession, IProvider } from "@openstarry/sdk";

function createMockWorker() {
  const emitter = new EventEmitter();
  const postedMessages: unknown[] = [];
  return {
    worker: {
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
      postMessage: vi.fn((msg: unknown) => postedMessages.push(msg)),
    } as unknown as import("node:worker_threads").Worker,
    emitter,
    postedMessages,
  };
}

function createMockDeps(): RpcHandlerDeps {
  const emittedEvents: AgentEvent[] = [];
  const pushedInputs: InputEvent[] = [];

  const mockSession: ISession = {
    id: "sess-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {},
  };

  return {
    bus: {
      on: vi.fn(() => () => {}),
      once: vi.fn(() => () => {}),
      onAny: vi.fn(() => () => {}),
      emit: vi.fn((event: AgentEvent) => { emittedEvents.push(event); }),
    },
    pushInput: vi.fn((event: InputEvent) => { pushedInputs.push(event); }),
    sessions: {
      create: vi.fn(() => mockSession),
      get: vi.fn(() => mockSession),
      list: vi.fn(() => [mockSession]),
      destroy: vi.fn(() => true),
      getStateManager: vi.fn(() => ({
        getMessages: () => [],
        addMessage: () => {},
        clear: () => {},
        snapshot: () => [],
        restore: () => {},
      })),
      getDefaultSession: vi.fn(() => mockSession),
    },
    tools: {
      list: () => [],
      get: () => undefined,
    },
    guides: {
      list: () => [],
    },
    providers: {
      list: () => [],
      get: () => undefined,
    },
  };
}

describe("RPC Handler", () => {
  let deps: RpcHandlerDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("handles BUS_EMIT messages by emitting on real bus", () => {
    const { worker, emitter } = createMockWorker();
    attachRpcHandler(worker, "test-plugin", deps);

    emitter.emit("message", {
      type: "BUS_EMIT",
      payload: {
        event: {
          type: "tool:result",
          timestamp: 1234567890,
          payload: { data: "ok" },
        },
      },
    });

    expect(deps.bus.emit).toHaveBeenCalledWith({
      type: "tool:result",
      timestamp: 1234567890,
      payload: { data: "ok" },
    });
  });

  it("handles PUSH_INPUT messages by calling pushInput", () => {
    const { worker, emitter } = createMockWorker();
    attachRpcHandler(worker, "test-plugin", deps);

    emitter.emit("message", {
      type: "PUSH_INPUT",
      payload: {
        inputEvent: {
          source: "mcp",
          inputType: "user_input",
          data: "hello",
          replyTo: "reply-1",
          sessionId: "sess-1",
        },
      },
    });

    expect(deps.pushInput).toHaveBeenCalledWith({
      source: "mcp",
      inputType: "user_input",
      data: "hello",
      replyTo: "reply-1",
      sessionId: "sess-1",
    });
  });

  it("handles SESSION_REQUEST create operation", async () => {
    const { worker, emitter, postedMessages } = createMockWorker();
    attachRpcHandler(worker, "test-plugin", deps);

    emitter.emit("message", {
      type: "SESSION_REQUEST",
      id: "req-1",
      payload: { operation: "create" },
    });

    // Allow async handling
    await new Promise((r) => setTimeout(r, 10));

    expect(deps.sessions.create).toHaveBeenCalled();
    expect(postedMessages).toHaveLength(1);
    const response = postedMessages[0] as Record<string, unknown>;
    expect(response.type).toBe("SESSION_RESPONSE");
    expect(response.replyTo).toBe("req-1");
    const payload = response.payload as Record<string, unknown>;
    expect(payload.success).toBe(true);
  });

  it("handles SESSION_REQUEST destroy operation", async () => {
    const { worker, emitter, postedMessages } = createMockWorker();
    attachRpcHandler(worker, "test-plugin", deps);

    emitter.emit("message", {
      type: "SESSION_REQUEST",
      id: "req-2",
      payload: { operation: "destroy", sessionId: "sess-to-kill" },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(deps.sessions.destroy).toHaveBeenCalledWith("sess-to-kill");
    expect(postedMessages).toHaveLength(1);
    const response = postedMessages[0] as Record<string, unknown>;
    const payload = response.payload as Record<string, unknown>;
    expect(payload.success).toBe(true);
  });

  it("handles SESSION_REQUEST list operation", async () => {
    const { worker, emitter, postedMessages } = createMockWorker();
    attachRpcHandler(worker, "test-plugin", deps);

    emitter.emit("message", {
      type: "SESSION_REQUEST",
      id: "req-3",
      payload: { operation: "list" },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(deps.sessions.list).toHaveBeenCalled();
    const response = postedMessages[0] as Record<string, unknown>;
    const payload = response.payload as Record<string, unknown>;
    expect(payload.success).toBe(true);
    expect(Array.isArray(payload.data)).toBe(true);
  });

  it("handles TOOLS_LIST_REQUEST", () => {
    const { worker, emitter, postedMessages } = createMockWorker();
    attachRpcHandler(worker, "test-plugin", deps);

    emitter.emit("message", {
      type: "TOOLS_LIST_REQUEST",
      id: "req-4",
    });

    expect(postedMessages).toHaveLength(1);
    const response = postedMessages[0] as Record<string, unknown>;
    expect(response.type).toBe("TOOLS_LIST_RESPONSE");
    expect(response.replyTo).toBe("req-4");
  });

  it("handles GUIDES_LIST_REQUEST", async () => {
    const { worker, emitter, postedMessages } = createMockWorker();
    attachRpcHandler(worker, "test-plugin", deps);

    emitter.emit("message", {
      type: "GUIDES_LIST_REQUEST",
      id: "req-5",
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(postedMessages).toHaveLength(1);
    const response = postedMessages[0] as Record<string, unknown>;
    expect(response.type).toBe("GUIDES_LIST_RESPONSE");
    expect(response.replyTo).toBe("req-5");
  });

  it("ignores messages with invalid/missing type", () => {
    const { worker, emitter } = createMockWorker();
    attachRpcHandler(worker, "test-plugin", deps);

    // null message
    emitter.emit("message", null);
    // undefined type
    emitter.emit("message", { foo: "bar" });
    // unknown type (INIT_COMPLETE handled by sandbox-manager, not rpc-handler)
    emitter.emit("message", { type: "INIT_COMPLETE" });

    expect(deps.bus.emit).not.toHaveBeenCalled();
    expect(deps.pushInput).not.toHaveBeenCalled();
  });

  it("returns cleanup function that removes listener", () => {
    const { worker, emitter } = createMockWorker();
    const cleanup = attachRpcHandler(worker, "test-plugin", deps);

    cleanup();

    // After cleanup, messages should not be handled
    emitter.emit("message", {
      type: "BUS_EMIT",
      payload: { event: { type: "test", timestamp: 0 } },
    });

    expect(deps.bus.emit).not.toHaveBeenCalled();
  });

  describe("Audit Logger Integration", () => {
    function createMockAuditLogger() {
      return {
        logRpcStart: vi.fn(() => "op-1"),
        logRpcEnd: vi.fn(),
        logWorkerEvent: vi.fn(),
        logToolInvocation: vi.fn(),
        logModuleBlocked: vi.fn(),
        flush: vi.fn(),
        dispose: vi.fn(),
      };
    }

    it("logs RPC operations when auditLogger is provided", () => {
      const { worker, emitter } = createMockWorker();
      const auditLogger = createMockAuditLogger();
      attachRpcHandler(worker, "test-plugin", deps, undefined, auditLogger as any);

      emitter.emit("message", {
        type: "BUS_EMIT",
        payload: {
          event: { type: "test:event", timestamp: 1234567890, payload: {} },
        },
      });

      expect(auditLogger.logRpcStart).toHaveBeenCalledWith(
        "BUS_EMIT",
        "BUS_EMIT",
        expect.any(Object),
      );
    });

    it("logs RPC success with logRpcEnd", async () => {
      const { worker, emitter } = createMockWorker();
      const auditLogger = createMockAuditLogger();
      attachRpcHandler(worker, "test-plugin", deps, undefined, auditLogger as any);

      emitter.emit("message", {
        type: "PUSH_INPUT",
        payload: {
          inputEvent: {
            source: "test",
            inputType: "user_input",
            data: "hello",
          },
        },
      });

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 10));

      expect(auditLogger.logRpcEnd).toHaveBeenCalledWith("op-1", "success");
    });

    it("does not log when auditLogger is not provided", () => {
      const { worker, emitter } = createMockWorker();
      // No audit logger passed
      attachRpcHandler(worker, "test-plugin", deps);

      emitter.emit("message", {
        type: "BUS_EMIT",
        payload: {
          event: { type: "test:event", timestamp: 0, payload: {} },
        },
      });

      // Should not throw or error — just works without logger
      expect(deps.bus.emit).toHaveBeenCalled();
    });

    it("logs sanitized args for PUSH_INPUT", () => {
      const { worker, emitter } = createMockWorker();
      const auditLogger = createMockAuditLogger();
      attachRpcHandler(worker, "test-plugin", deps, undefined, auditLogger as any);

      emitter.emit("message", {
        type: "PUSH_INPUT",
        payload: {
          inputEvent: {
            source: "mcp",
            inputType: "user_input",
            data: "sensitive data",
          },
        },
      });

      expect(auditLogger.logRpcStart).toHaveBeenCalledWith(
        "PUSH_INPUT",
        "PUSH_INPUT",
        expect.objectContaining({ inputEvent: expect.any(Object) }),
      );
    });
  });

  describe("Provider RPC Handlers", () => {
    it("handles PROVIDERS_LIST_REQUEST with registered providers", () => {
      const mockProvider: IProvider = {
        id: "test-provider",
        name: "Test Provider",
        models: [{ id: "test-model", name: "Test Model", contextWindow: 4096 }],
        chat: async function* () { yield { type: "text", text: "test" }; },
      };
      const depsWithProvider = createMockDeps();
      depsWithProvider.providers = {
        list: () => [mockProvider],
        get: (id: string) => (id === "test-provider" ? mockProvider : undefined),
      };

      const { worker, emitter, postedMessages } = createMockWorker();
      attachRpcHandler(worker, "test-plugin", depsWithProvider);

      emitter.emit("message", {
        type: "PROVIDERS_LIST_REQUEST",
        id: "req-providers-1",
      });

      expect(postedMessages).toHaveLength(1);
      const response = postedMessages[0] as Record<string, unknown>;
      expect(response.type).toBe("PROVIDERS_LIST_RESPONSE");
      expect(response.replyTo).toBe("req-providers-1");
      const payload = response.payload as { providers: Array<{ id: string; name: string }> };
      expect(payload.providers).toHaveLength(1);
      expect(payload.providers[0].id).toBe("test-provider");
      expect(payload.providers[0].name).toBe("Test Provider");
    });

    it("handles PROVIDERS_LIST_REQUEST with empty registry", () => {
      const depsEmpty = createMockDeps();
      depsEmpty.providers = { list: () => [], get: () => undefined };

      const { worker, emitter, postedMessages } = createMockWorker();
      attachRpcHandler(worker, "test-plugin", depsEmpty);

      emitter.emit("message", {
        type: "PROVIDERS_LIST_REQUEST",
        id: "req-providers-2",
      });

      expect(postedMessages).toHaveLength(1);
      const response = postedMessages[0] as Record<string, unknown>;
      expect(response.type).toBe("PROVIDERS_LIST_RESPONSE");
      const payload = response.payload as { providers: unknown[] };
      expect(payload.providers).toEqual([]);
    });

    it("handles PROVIDERS_GET_REQUEST for existing provider", () => {
      const mockProvider: IProvider = {
        id: "test-provider",
        name: "Test Provider",
        models: [{ id: "test-model", name: "Test Model", contextWindow: 8192 }],
        chat: async function* () {},
      };
      const depsWithProvider = createMockDeps();
      depsWithProvider.providers = {
        list: () => [mockProvider],
        get: (id: string) => (id === "test-provider" ? mockProvider : undefined),
      };

      const { worker, emitter, postedMessages } = createMockWorker();
      attachRpcHandler(worker, "test-plugin", depsWithProvider);

      emitter.emit("message", {
        type: "PROVIDERS_GET_REQUEST",
        id: "req-providers-3",
        payload: { providerId: "test-provider" },
      });

      expect(postedMessages).toHaveLength(1);
      const response = postedMessages[0] as Record<string, unknown>;
      expect(response.type).toBe("PROVIDERS_GET_RESPONSE");
      const payload = response.payload as { provider: { id: string; models: Array<{ contextWindow: number }> } };
      expect(payload.provider.id).toBe("test-provider");
      expect(payload.provider.models[0].contextWindow).toBe(8192);
    });

    it("handles PROVIDERS_GET_REQUEST for non-existent provider", () => {
      const depsEmpty = createMockDeps();
      depsEmpty.providers = { list: () => [], get: () => undefined };

      const { worker, emitter, postedMessages } = createMockWorker();
      attachRpcHandler(worker, "test-plugin", depsEmpty);

      emitter.emit("message", {
        type: "PROVIDERS_GET_REQUEST",
        id: "req-providers-4",
        payload: { providerId: "nonexistent" },
      });

      expect(postedMessages).toHaveLength(1);
      const response = postedMessages[0] as Record<string, unknown>;
      expect(response.type).toBe("PROVIDERS_GET_RESPONSE");
      const payload = response.payload as { provider: null };
      expect(payload.provider).toBeNull();
    });

    it("PROVIDERS_LIST_RESPONSE excludes chat() method", () => {
      const mockProvider: IProvider = {
        id: "test",
        name: "Test",
        models: [],
        chat: async function* () {},
      };
      const depsWithProvider = createMockDeps();
      depsWithProvider.providers = { list: () => [mockProvider], get: () => mockProvider };

      const { worker, emitter, postedMessages } = createMockWorker();
      attachRpcHandler(worker, "test-plugin", depsWithProvider);

      emitter.emit("message", {
        type: "PROVIDERS_LIST_REQUEST",
        id: "req-providers-5",
      });

      expect(postedMessages).toHaveLength(1);
      const response = postedMessages[0] as Record<string, unknown>;
      expect(response.type).toBe("PROVIDERS_LIST_RESPONSE");
      const payload = response.payload as { providers: Array<{ chat?: unknown }> };
      expect(payload.providers[0].chat).toBeUndefined();
    });
  });
});
