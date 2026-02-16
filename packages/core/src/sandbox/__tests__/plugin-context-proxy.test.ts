import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createPluginContextProxy } from "../plugin-context-proxy.js";
import type { SerializedPluginContext } from "../messages.js";

// Create a mock MessagePort
function createMockPort() {
  const emitter = new EventEmitter();
  const messages: unknown[] = [];
  return {
    port: {
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
      postMessage: vi.fn((msg: unknown) => messages.push(msg)),
    } as unknown as import("node:worker_threads").MessagePort,
    messages,
    emitter,
  };
}

const baseContext: SerializedPluginContext = {
  workingDirectory: "/home/user/project",
  agentId: "test-agent",
  config: { debug: true },
};

describe("PluginContextProxy", () => {
  it("creates proxy with correct static properties", () => {
    const { port } = createMockPort();
    const ctx = createPluginContextProxy(port, baseContext);

    expect(ctx.workingDirectory).toBe("/home/user/project");
    expect(ctx.agentId).toBe("test-agent");
    expect(ctx.config).toEqual({ debug: true });
  });

  it("provides bus with emit, on, once, onAny methods", () => {
    const { port } = createMockPort();
    const ctx = createPluginContextProxy(port, baseContext);

    expect(typeof ctx.bus.emit).toBe("function");
    expect(typeof ctx.bus.on).toBe("function");
    expect(typeof ctx.bus.once).toBe("function");
    expect(typeof ctx.bus.onAny).toBe("function");
  });

  it("bus.emit sends BUS_EMIT message via postMessage", () => {
    const { port, messages } = createMockPort();
    const ctx = createPluginContextProxy(port, baseContext);

    ctx.bus.emit({
      type: "test:event",
      timestamp: 1234567890,
      payload: { data: "hello" },
    });

    expect(messages).toHaveLength(1);
    const msg = messages[0] as Record<string, unknown>;
    expect(msg.type).toBe("BUS_EMIT");
    const payload = msg.payload as Record<string, unknown>;
    const event = payload.event as Record<string, unknown>;
    expect(event.type).toBe("test:event");
    expect(event.timestamp).toBe(1234567890);
    expect(event.payload).toEqual({ data: "hello" });
  });

  it("bus.on returns a no-op unsubscribe function (deferred to Plan07.1)", () => {
    const { port } = createMockPort();
    const ctx = createPluginContextProxy(port, baseContext);

    const unsub = ctx.bus.on("test", () => {});
    expect(typeof unsub).toBe("function");
    // Should not throw
    unsub();
  });

  it("pushInput sends PUSH_INPUT message", () => {
    const { port, messages } = createMockPort();
    const ctx = createPluginContextProxy(port, baseContext);

    ctx.pushInput({
      source: "mcp",
      inputType: "user_input",
      data: "test data",
      replyTo: "reply-123",
      sessionId: "sess-456",
    });

    expect(messages).toHaveLength(1);
    const msg = messages[0] as Record<string, unknown>;
    expect(msg.type).toBe("PUSH_INPUT");
    const payload = msg.payload as Record<string, unknown>;
    const inputEvent = payload.inputEvent as Record<string, unknown>;
    expect(inputEvent.source).toBe("mcp");
    expect(inputEvent.data).toBe("test data");
    expect(inputEvent.replyTo).toBe("reply-123");
    expect(inputEvent.sessionId).toBe("sess-456");
  });

  it("sessions.create sends SESSION_REQUEST message", () => {
    const { port, messages } = createMockPort();
    const ctx = createPluginContextProxy(port, baseContext);

    const session = ctx.sessions.create();
    expect(session.id).toMatch(/^pending-/);

    expect(messages).toHaveLength(1);
    const msg = messages[0] as Record<string, unknown>;
    expect(msg.type).toBe("SESSION_REQUEST");
    const payload = msg.payload as Record<string, unknown>;
    expect(payload.operation).toBe("create");
  });

  it("sessions.destroy sends SESSION_REQUEST with destroy operation", () => {
    const { port, messages } = createMockPort();
    const ctx = createPluginContextProxy(port, baseContext);

    const result = ctx.sessions.destroy("session-to-destroy");
    expect(result).toBe(true);

    expect(messages).toHaveLength(1);
    const msg = messages[0] as Record<string, unknown>;
    expect(msg.type).toBe("SESSION_REQUEST");
    const payload = msg.payload as Record<string, unknown>;
    expect(payload.operation).toBe("destroy");
    expect(payload.sessionId).toBe("session-to-destroy");
  });

  it("sessions.get returns undefined (sync limitation)", () => {
    const { port } = createMockPort();
    const ctx = createPluginContextProxy(port, baseContext);

    const session = ctx.sessions.get("any-id");
    expect(session).toBeUndefined();
  });

  it("sessions.list returns empty array (sync limitation)", () => {
    const { port } = createMockPort();
    const ctx = createPluginContextProxy(port, baseContext);

    const sessions = ctx.sessions.list();
    expect(sessions).toEqual([]);
  });

  it("sessions.getDefaultSession returns stub session", () => {
    const { port } = createMockPort();
    const ctx = createPluginContextProxy(port, baseContext);

    const session = ctx.sessions.getDefaultSession();
    expect(session.id).toBe("default");
  });

  it("sessions.getStateManager returns stub with all methods", () => {
    const { port } = createMockPort();
    const ctx = createPluginContextProxy(port, baseContext);

    const sm = ctx.sessions.getStateManager();
    expect(sm.getMessages()).toEqual([]);
    expect(sm.snapshot()).toEqual([]);
    expect(() => sm.addMessage({ role: "user", content: [{ type: "text", text: "hi" }] })).not.toThrow();
    expect(() => sm.clear()).not.toThrow();
    expect(() => sm.restore([])).not.toThrow();
  });

  it("tools proxy returns empty results", () => {
    const { port } = createMockPort();
    const ctx = createPluginContextProxy(port, baseContext);

    expect(ctx.tools?.list()).toEqual([]);
    expect(ctx.tools?.get("any")).toBeUndefined();
  });

  it("guides proxy returns empty results", () => {
    const { port } = createMockPort();
    const ctx = createPluginContextProxy(port, baseContext);

    expect(ctx.guides?.list()).toEqual([]);
  });

  it("multiple bus.emit calls each produce a message", () => {
    const { port, messages } = createMockPort();
    const ctx = createPluginContextProxy(port, baseContext);

    for (let i = 0; i < 5; i++) {
      ctx.bus.emit({ type: `event-${i}`, timestamp: i });
    }

    expect(messages).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      const msg = messages[i] as Record<string, unknown>;
      expect(msg.type).toBe("BUS_EMIT");
    }
  });
});
