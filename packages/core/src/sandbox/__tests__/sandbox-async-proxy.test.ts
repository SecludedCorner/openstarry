import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { attachRpcHandler, type RpcHandlerDeps, type SubscriptionState } from "../rpc-handler.js";
import type { ISession, ITool, IGuide } from "@openstarry/sdk";
import { z } from "zod";

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
  const mockSession: ISession = {
    id: "sess-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {},
  };

  const mockTool: ITool = {
    id: "tool-1",
    description: "Test tool",
    parameters: z.object({ input: z.string() }),
    execute: vi.fn(async () => "result"),
  };

  const mockGuide: IGuide = {
    id: "guide-1",
    name: "Test guide",
    getSystemPrompt: vi.fn(async () => "You are a helpful assistant"),
  };

  return {
    bus: {
      on: vi.fn(() => () => {}),
      once: vi.fn(() => () => {}),
      onAny: vi.fn(() => () => {}),
      emit: vi.fn(),
    },
    pushInput: vi.fn(),
    sessions: {
      create: vi.fn(() => mockSession),
      get: vi.fn((id: string) => id === "sess-1" ? mockSession : undefined),
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
      list: () => [mockTool],
      get: (id: string) => id === "tool-1" ? mockTool : undefined,
    },
    guides: {
      list: () => [mockGuide],
    },
  };
}

describe("Sandbox Async Proxy", () => {
  let deps: RpcHandlerDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  describe("TOOLS_GET_REQUEST", () => {
    it("returns serialized tool for existing tool", async () => {
      const { worker, emitter, postedMessages } = createMockWorker();
      attachRpcHandler(worker, "test-plugin", deps);

      emitter.emit("message", {
        type: "TOOLS_GET_REQUEST",
        id: "req-1",
        payload: { toolId: "tool-1" },
      });

      expect(postedMessages).toHaveLength(1);
      const response = postedMessages[0] as Record<string, unknown>;
      expect(response.type).toBe("TOOLS_GET_RESPONSE");
      expect(response.replyTo).toBe("req-1");
      const payload = response.payload as { tool: { id: string; description: string } | null };
      expect(payload.tool).not.toBeNull();
      expect(payload.tool!.id).toBe("tool-1");
      expect(payload.tool!.description).toBe("Test tool");
    });

    it("returns null for non-existent tool", () => {
      const { worker, emitter, postedMessages } = createMockWorker();
      attachRpcHandler(worker, "test-plugin", deps);

      emitter.emit("message", {
        type: "TOOLS_GET_REQUEST",
        id: "req-2",
        payload: { toolId: "nonexistent" },
      });

      const response = postedMessages[0] as Record<string, unknown>;
      const payload = response.payload as { tool: null };
      expect(payload.tool).toBeNull();
    });
  });

  describe("GUIDES_GET_REQUEST", () => {
    it("returns serialized guide for existing guide", async () => {
      const { worker, emitter, postedMessages } = createMockWorker();
      attachRpcHandler(worker, "test-plugin", deps);

      emitter.emit("message", {
        type: "GUIDES_GET_REQUEST",
        id: "req-3",
        payload: { guideId: "guide-1" },
      });

      // Allow async handling
      await new Promise((r) => setTimeout(r, 10));

      expect(postedMessages).toHaveLength(1);
      const response = postedMessages[0] as Record<string, unknown>;
      expect(response.type).toBe("GUIDES_GET_RESPONSE");
      expect(response.replyTo).toBe("req-3");
      const payload = response.payload as { guide: { id: string; content: string } | null };
      expect(payload.guide).not.toBeNull();
      expect(payload.guide!.id).toBe("guide-1");
      expect(payload.guide!.content).toBe("You are a helpful assistant");
    });

    it("returns null for non-existent guide", async () => {
      const { worker, emitter, postedMessages } = createMockWorker();
      attachRpcHandler(worker, "test-plugin", deps);

      emitter.emit("message", {
        type: "GUIDES_GET_REQUEST",
        id: "req-4",
        payload: { guideId: "nonexistent" },
      });

      await new Promise((r) => setTimeout(r, 10));

      const response = postedMessages[0] as Record<string, unknown>;
      const payload = response.payload as { guide: null };
      expect(payload.guide).toBeNull();
    });
  });

  describe("SESSION_REQUEST get/list", () => {
    it("SESSION_REQUEST get returns session data", async () => {
      const { worker, emitter, postedMessages } = createMockWorker();
      attachRpcHandler(worker, "test-plugin", deps);

      emitter.emit("message", {
        type: "SESSION_REQUEST",
        id: "req-5",
        payload: { operation: "get", sessionId: "sess-1" },
      });

      await new Promise((r) => setTimeout(r, 10));

      const response = postedMessages[0] as Record<string, unknown>;
      expect(response.type).toBe("SESSION_RESPONSE");
      const payload = response.payload as { success: boolean; data: { id: string } | null };
      expect(payload.success).toBe(true);
      expect(payload.data).toEqual({ id: "sess-1" });
    });

    it("SESSION_REQUEST get returns null for unknown session", async () => {
      const { worker, emitter, postedMessages } = createMockWorker();
      deps.sessions.get = vi.fn(() => undefined);
      attachRpcHandler(worker, "test-plugin", deps);

      emitter.emit("message", {
        type: "SESSION_REQUEST",
        id: "req-6",
        payload: { operation: "get", sessionId: "unknown" },
      });

      await new Promise((r) => setTimeout(r, 10));

      const response = postedMessages[0] as Record<string, unknown>;
      const payload = response.payload as { success: boolean; data: null };
      expect(payload.success).toBe(true);
      expect(payload.data).toBeNull();
    });

    it("SESSION_REQUEST list returns array of sessions", async () => {
      const { worker, emitter, postedMessages } = createMockWorker();
      attachRpcHandler(worker, "test-plugin", deps);

      emitter.emit("message", {
        type: "SESSION_REQUEST",
        id: "req-7",
        payload: { operation: "list" },
      });

      await new Promise((r) => setTimeout(r, 10));

      const response = postedMessages[0] as Record<string, unknown>;
      const payload = response.payload as { success: boolean; data: Array<{ id: string }> };
      expect(payload.success).toBe(true);
      expect(Array.isArray(payload.data)).toBe(true);
      expect(payload.data[0].id).toBe("sess-1");
    });
  });

  describe("TOOLS_LIST_REQUEST with tools populated", () => {
    it("returns serialized tools list including parameters", () => {
      const { worker, emitter, postedMessages } = createMockWorker();
      attachRpcHandler(worker, "test-plugin", deps);

      emitter.emit("message", {
        type: "TOOLS_LIST_REQUEST",
        id: "req-8",
      });

      const response = postedMessages[0] as Record<string, unknown>;
      const payload = response.payload as { tools: Array<{ id: string; description: string; parametersSchema: unknown }> };
      expect(payload.tools).toHaveLength(1);
      expect(payload.tools[0].id).toBe("tool-1");
      expect(payload.tools[0].description).toBe("Test tool");
    });
  });
});
