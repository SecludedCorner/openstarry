/**
 * MockHost unit tests.
 */

import { describe, it, expect, vi } from "vitest";
import { MockHost, createMockHost } from "./mock-host.js";
import type { AgentEvent, InputEvent } from "../types/events.js";

describe("MockHost", () => {
  describe("Constructor", () => {
    it("creates MockHost with default options", () => {
      const host = new MockHost();
      const ctx = host.createContext();

      expect(ctx.workingDirectory).toBe("/tmp/mock");
      expect(ctx.agentId).toBe("mock-agent");
      expect(ctx.config).toEqual({});
    });

    it("creates MockHost with custom options", () => {
      const host = new MockHost({
        workingDirectory: "/custom/path",
        agentId: "test-agent",
        config: { verbose: true },
      });
      const ctx = host.createContext();

      expect(ctx.workingDirectory).toBe("/custom/path");
      expect(ctx.agentId).toBe("test-agent");
      expect(ctx.config).toEqual({ verbose: true });
    });
  });

  describe("createContext", () => {
    it("returns valid IPluginContext", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      expect(ctx.bus).toBeDefined();
      expect(ctx.bus.emit).toBeDefined();
      expect(ctx.bus.on).toBeDefined();
      expect(ctx.bus.once).toBeDefined();
      expect(ctx.bus.onAny).toBeDefined();
      expect(ctx.pushInput).toBeDefined();
      expect(ctx.sessions).toBeDefined();
      expect(ctx.tools).toBeDefined();
      expect(ctx.guides).toBeDefined();
      expect(ctx.providers).toBeDefined();
    });
  });

  describe("EventBus", () => {
    it("emit captures events in getEmittedEvents", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      const event1: AgentEvent = { type: "test:event1", timestamp: Date.now() };
      const event2: AgentEvent = { type: "test:event2", timestamp: Date.now(), payload: "data" };

      ctx.bus.emit(event1);
      ctx.bus.emit(event2);

      const emitted = host.getEmittedEvents();
      expect(emitted).toHaveLength(2);
      expect(emitted[0]).toEqual(event1);
      expect(emitted[1]).toEqual(event2);
    });

    it("on() registers handler and invokes on emit", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      const handler = vi.fn();
      ctx.bus.on("test:event", handler);

      const event: AgentEvent = { type: "test:event", timestamp: Date.now() };
      ctx.bus.emit(event);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it("on() unsubscribe function works", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      const handler = vi.fn();
      const unsubscribe = ctx.bus.on("test:event", handler);

      const event: AgentEvent = { type: "test:event", timestamp: Date.now() };
      ctx.bus.emit(event);
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();
      ctx.bus.emit(event);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("once() auto-unsubscribes after first emit", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      const handler = vi.fn();
      ctx.bus.once("test:event", handler);

      const event: AgentEvent = { type: "test:event", timestamp: Date.now() };
      ctx.bus.emit(event);
      expect(handler).toHaveBeenCalledTimes(1);

      ctx.bus.emit(event);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("onAny() receives all event types", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      const handler = vi.fn();
      ctx.bus.onAny(handler);

      const event1: AgentEvent = { type: "test:event1", timestamp: Date.now() };
      const event2: AgentEvent = { type: "test:event2", timestamp: Date.now() };

      ctx.bus.emit(event1);
      ctx.bus.emit(event2);

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenNthCalledWith(1, event1);
      expect(handler).toHaveBeenNthCalledWith(2, event2);
    });

    it("multiple handlers for same event type (all invoked)", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      const handler1 = vi.fn();
      const handler2 = vi.fn();
      ctx.bus.on("test:event", handler1);
      ctx.bus.on("test:event", handler2);

      const event: AgentEvent = { type: "test:event", timestamp: Date.now() };
      ctx.bus.emit(event);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("getHandlerCounts returns correct counts", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      ctx.bus.on("test:event1", vi.fn());
      ctx.bus.on("test:event1", vi.fn());
      ctx.bus.on("test:event2", vi.fn());
      ctx.bus.onAny(vi.fn());

      const counts = host.getHandlerCounts();
      expect(counts["test:event1"]).toBe(2);
      expect(counts["test:event2"]).toBe(1);
      expect(counts["*"]).toBe(1);
    });
  });

  describe("pushInput", () => {
    it("pushInput captures events in getInputEvents", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      const input1: InputEvent = { source: "cli", inputType: "user_input", data: "hello" };
      const input2: InputEvent = { source: "webhook", inputType: "command", data: { cmd: "test" } };

      ctx.pushInput(input1);
      ctx.pushInput(input2);

      const inputs = host.getInputEvents();
      expect(inputs).toHaveLength(2);
      expect(inputs[0]).toEqual(input1);
      expect(inputs[1]).toEqual(input2);
    });
  });

  describe("Session Management", () => {
    it("createSession creates session with unique ID", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      const session1 = ctx.sessions.create({ meta: "data1" });
      const session2 = ctx.sessions.create({ meta: "data2" });

      expect(session1.id).toBeDefined();
      expect(session2.id).toBeDefined();
      expect(session1.id).not.toBe(session2.id);
      expect(session1.metadata).toEqual({ meta: "data1" });
      expect(session2.metadata).toEqual({ meta: "data2" });
    });

    it("sessions.get retrieves created session", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      const created = ctx.sessions.create({ test: true });
      const retrieved = ctx.sessions.get(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.metadata).toEqual({ test: true });
    });

    it("sessions.list returns all sessions", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      const session1 = ctx.sessions.create();
      const session2 = ctx.sessions.create();

      const list = ctx.sessions.list();
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list.find(s => s.id === session1.id)).toBeDefined();
      expect(list.find(s => s.id === session2.id)).toBeDefined();
    });

    it("sessions.getDefaultSession returns default session (always exists)", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      const defaultSession = ctx.sessions.getDefaultSession();
      expect(defaultSession).toBeDefined();
      expect(defaultSession.id).toBe("default");
      expect(defaultSession.metadata._isDefault).toBe(true);
    });

    it("sessions.destroy removes session", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      const session = ctx.sessions.create();
      expect(ctx.sessions.get(session.id)).toBeDefined();

      const destroyed = ctx.sessions.destroy(session.id);
      expect(destroyed).toBe(true);
      expect(ctx.sessions.get(session.id)).toBeUndefined();
    });

    it("sessions.destroy cannot remove default session", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      const defaultSession = ctx.sessions.getDefaultSession();
      const destroyed = ctx.sessions.destroy(defaultSession.id);
      expect(destroyed).toBe(false);
      expect(ctx.sessions.get(defaultSession.id)).toBeDefined();
    });
  });

  describe("Tool/Guide/Provider Registries", () => {
    it("registerTool makes tool available in ctx.tools.list()", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      const tool = {
        id: "test-tool",
        description: "Test tool",
        parameters: {} as any,
        execute: async () => "result",
      };

      host.registerTool(tool);

      const tools = ctx.tools?.list() ?? [];
      expect(tools).toHaveLength(1);
      expect(tools[0].id).toBe("test-tool");
    });

    it("registerTool makes tool available in ctx.tools.get()", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      const tool = {
        id: "test-tool",
        description: "Test tool",
        parameters: {} as any,
        execute: async () => "result",
      };

      host.registerTool(tool);

      const retrieved = ctx.tools?.get("test-tool");
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe("test-tool");
    });

    it("registerGuide makes guide available in ctx.guides.list()", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      const guide = {
        id: "test-guide",
        content: "Test guide content",
      };

      host.registerGuide(guide);

      const guides = ctx.guides?.list() ?? [];
      expect(guides).toHaveLength(1);
      expect(guides[0].id).toBe("test-guide");
    });

    it("registerProvider makes provider available in ctx.providers.list()", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      const provider = {
        id: "test-provider",
        name: "Test Provider",
        generateResponse: async () => ({ type: "finish", stopReason: "end_turn" }),
      };

      host.registerProvider(provider as any);

      const providers = ctx.providers?.list() ?? [];
      expect(providers).toHaveLength(1);
      expect(providers[0].id).toBe("test-provider");
    });
  });

  describe("clearEvents", () => {
    it("clearEvents clears captured events", () => {
      const host = createMockHost();
      const ctx = host.createContext();

      ctx.bus.emit({ type: "test", timestamp: Date.now() });
      ctx.pushInput({ source: "test", inputType: "test", data: "test" });

      expect(host.getEmittedEvents()).toHaveLength(1);
      expect(host.getInputEvents()).toHaveLength(1);

      host.clearEvents();

      expect(host.getEmittedEvents()).toHaveLength(0);
      expect(host.getInputEvents()).toHaveLength(0);
    });
  });
});
