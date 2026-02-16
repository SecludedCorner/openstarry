import { describe, it, expect, vi } from "vitest";
import { createSessionManager } from "./manager.js";
import { AgentEventType } from "@openstarry/sdk";
import type { EventBus, AgentEvent } from "@openstarry/sdk";

function createMockBus(): EventBus & { emitted: AgentEvent[] } {
  const emitted: AgentEvent[] = [];
  return {
    emitted,
    on: vi.fn(() => () => {}),
    once: vi.fn(() => () => {}),
    onAny: vi.fn(() => () => {}),
    emit(event: AgentEvent) {
      emitted.push(event);
    },
  };
}

describe("SessionManager", () => {
  it("creates default session on construction", () => {
    const bus = createMockBus();
    const mgr = createSessionManager(bus);

    const defaultSession = mgr.getDefaultSession();
    expect(defaultSession).toBeDefined();
    expect(defaultSession.id).toBe("__default__");
    expect(defaultSession.createdAt).toBeGreaterThan(0);
  });

  it("create() returns valid ISession with UUID", () => {
    const bus = createMockBus();
    const mgr = createSessionManager(bus);

    const session = mgr.create();
    expect(session.id).toBeTruthy();
    expect(session.id).not.toBe("__default__");
    // UUID format check (8-4-4-4-12 hex)
    expect(session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(session.createdAt).toBeGreaterThan(0);
    expect(session.updatedAt).toBeGreaterThan(0);
    expect(session.metadata).toEqual({});
  });

  it("create() stores metadata on session", () => {
    const bus = createMockBus();
    const mgr = createSessionManager(bus);

    const session = mgr.create({ userId: "alice" });
    expect(session.metadata).toEqual({ userId: "alice" });
  });

  it("get() returns session by ID", () => {
    const bus = createMockBus();
    const mgr = createSessionManager(bus);

    const session = mgr.create();
    const retrieved = mgr.get(session.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(session.id);
  });

  it("get() returns undefined for unknown ID", () => {
    const bus = createMockBus();
    const mgr = createSessionManager(bus);

    expect(mgr.get("nonexistent")).toBeUndefined();
  });

  it("list() returns all sessions including default", () => {
    const bus = createMockBus();
    const mgr = createSessionManager(bus);

    mgr.create();
    mgr.create();
    const sessions = mgr.list();
    // default + 2 created = 3
    expect(sessions).toHaveLength(3);
  });

  it("destroy() clears state and returns true", () => {
    const bus = createMockBus();
    const mgr = createSessionManager(bus);

    const session = mgr.create();
    const sm = mgr.getStateManager(session.id);
    sm.addMessage({ id: "m1", role: "user", content: [{ type: "text", text: "hi" }], createdAt: Date.now() });
    expect(sm.getMessages()).toHaveLength(1);

    const result = mgr.destroy(session.id);
    expect(result).toBe(true);
    expect(mgr.get(session.id)).toBeUndefined();
  });

  it("destroy() returns false for default session", () => {
    const bus = createMockBus();
    const mgr = createSessionManager(bus);

    const result = mgr.destroy("__default__");
    expect(result).toBe(false);
    expect(mgr.getDefaultSession()).toBeDefined();
  });

  it("destroy() returns false for unknown session", () => {
    const bus = createMockBus();
    const mgr = createSessionManager(bus);

    const result = mgr.destroy("nonexistent");
    expect(result).toBe(false);
  });

  it("getStateManager() returns session-specific state", () => {
    const bus = createMockBus();
    const mgr = createSessionManager(bus);

    const s1 = mgr.create();
    const s2 = mgr.create();

    const sm1 = mgr.getStateManager(s1.id);
    const sm2 = mgr.getStateManager(s2.id);

    sm1.addMessage({ id: "m1", role: "user", content: [{ type: "text", text: "hello from s1" }], createdAt: Date.now() });
    sm2.addMessage({ id: "m2", role: "user", content: [{ type: "text", text: "hello from s2" }], createdAt: Date.now() });

    expect(sm1.getMessages()).toHaveLength(1);
    expect(sm2.getMessages()).toHaveLength(1);
    expect(sm1.getMessages()[0].id).toBe("m1");
    expect(sm2.getMessages()[0].id).toBe("m2");
  });

  it("getStateManager(undefined) returns default state", () => {
    const bus = createMockBus();
    const mgr = createSessionManager(bus);

    const defaultSm = mgr.getStateManager(undefined);
    const directDefaultSm = mgr.getStateManager("__default__");

    // Both should be the same instance
    defaultSm.addMessage({ id: "m1", role: "user", content: [{ type: "text", text: "test" }], createdAt: Date.now() });
    expect(directDefaultSm.getMessages()).toHaveLength(1);
  });

  it("getStateManager('unknown') returns default state", () => {
    const bus = createMockBus();
    const mgr = createSessionManager(bus);

    const sm = mgr.getStateManager("unknown-id");
    const defaultSm = mgr.getStateManager(undefined);

    sm.addMessage({ id: "m1", role: "user", content: [{ type: "text", text: "test" }], createdAt: Date.now() });
    expect(defaultSm.getMessages()).toHaveLength(1);
  });

  it("emits SESSION_CREATED on create", () => {
    const bus = createMockBus();
    const mgr = createSessionManager(bus);

    const session = mgr.create({ tag: "test" });
    const event = bus.emitted.find(
      (e) => e.type === AgentEventType.SESSION_CREATED,
    );
    expect(event).toBeDefined();
    expect((event!.payload as Record<string, unknown>).sessionId).toBe(session.id);
  });

  it("emits SESSION_DESTROYED on destroy", () => {
    const bus = createMockBus();
    const mgr = createSessionManager(bus);

    const session = mgr.create();
    mgr.destroy(session.id);

    const event = bus.emitted.find(
      (e) => e.type === AgentEventType.SESSION_DESTROYED,
    );
    expect(event).toBeDefined();
    expect((event!.payload as Record<string, unknown>).sessionId).toBe(session.id);
  });

  it("getStateManager falls back to default for unknown session (observability)", () => {
    const bus = createMockBus();
    const mgr = createSessionManager(bus);

    // Verify fallback behavior works (logger.debug is called internally)
    const defaultSm = mgr.getStateManager();
    const unknownSm = mgr.getStateManager("nonexistent-session-id");

    // Both should return the same default state manager
    defaultSm.addMessage({ id: "m1", role: "user", content: [{ type: "text", text: "test" }], createdAt: Date.now() });
    expect(unknownSm.getMessages()).toHaveLength(1);
  });

  it("destroy fails on default session (observability)", () => {
    const bus = createMockBus();
    const mgr = createSessionManager(bus);

    // Verify destroy returns false for default session (logger.debug is called internally)
    const result = mgr.destroy("__default__");
    expect(result).toBe(false);
    expect(mgr.getDefaultSession()).toBeDefined();
  });

  it("destroy fails on nonexistent session (observability)", () => {
    const bus = createMockBus();
    const mgr = createSessionManager(bus);

    // Verify destroy returns false for nonexistent session (logger.debug is called internally)
    const result = mgr.destroy("nonexistent-session-id");
    expect(result).toBe(false);
  });
});
