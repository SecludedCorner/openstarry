/**
 * E2E Tests: Session Isolation
 * Tests session creation, destruction, and isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAgentFixture, type IAgentTestFixture } from "./helpers/index.js";
import { AgentEventType } from "@openstarry/sdk";

describe("E2E: Session Isolation", () => {
  let fixture: IAgentTestFixture;

  beforeEach(() => {
    fixture = createAgentFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("should create default session on start", async () => {
    await fixture.start();

    const defaultSession = fixture.core.sessionManager.getDefaultSession();
    expect(defaultSession).toBeDefined();
    expect(defaultSession.id).toBe("__default__");

    const sessions = fixture.core.sessionManager.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("__default__");
  });

  it("should route input to default session", async () => {
    fixture.mockProvider.setNextResponse("Hello from default session");
    await fixture.start();

    fixture.pushInput("Test message");

    const loopStartedEvent = await fixture.waitForEvent(
      AgentEventType.LOOP_STARTED,
      3000,
    );
    expect(loopStartedEvent).toBeDefined();
  });

  it("should create multiple sessions with different IDs", async () => {
    await fixture.start();

    const session1 = fixture.core.sessionManager.create();
    const session2 = fixture.core.sessionManager.create();

    const sessions = fixture.core.sessionManager.list();
    expect(sessions.length).toBeGreaterThanOrEqual(3); // default + session-1 + session-2
    expect(sessions.map((s) => s.id)).toContain(session1.id);
    expect(sessions.map((s) => s.id)).toContain(session2.id);
  });

  it("should destroy session and emit event", async () => {
    await fixture.start();

    const session = fixture.core.sessionManager.create();
    const sessionId = session.id;

    fixture.core.sessionManager.destroy(sessionId);

    const sessionDestroyedEvent = fixture.events.find(
      (e) =>
        e.type === AgentEventType.SESSION_DESTROYED &&
        (e.payload as any)?.sessionId === sessionId,
    );
    expect(sessionDestroyedEvent).toBeDefined();

    const sessions = fixture.core.sessionManager.list();
    expect(sessions.map((s) => s.id)).not.toContain(sessionId);
  });

  it("should emit session lifecycle events", async () => {
    await fixture.start();

    const session = fixture.core.sessionManager.create();
    const sessionId = session.id;

    const createdEvent = fixture.events.find(
      (e) =>
        e.type === AgentEventType.SESSION_CREATED &&
        (e.payload as any)?.sessionId === sessionId,
    );
    expect(createdEvent).toBeDefined();

    fixture.core.sessionManager.destroy(sessionId);

    const destroyedEvent = fixture.events.find(
      (e) =>
        e.type === AgentEventType.SESSION_DESTROYED &&
        (e.payload as any)?.sessionId === sessionId,
    );
    expect(destroyedEvent).toBeDefined();
  });

  it("should list all sessions via list()", async () => {
    await fixture.start();

    const alpha = fixture.core.sessionManager.create();
    const beta = fixture.core.sessionManager.create();
    const gamma = fixture.core.sessionManager.create();

    const sessions = fixture.core.sessionManager.list();
    expect(sessions.length).toBeGreaterThanOrEqual(4); // default + 3 new
    expect(sessions.map((s) => s.id)).toContain(alpha.id);
    expect(sessions.map((s) => s.id)).toContain(beta.id);
    expect(sessions.map((s) => s.id)).toContain(gamma.id);
  });

  it("should handle session creation with metadata", async () => {
    await fixture.start();

    const metadata = { source: "test", userId: "user-123" };
    const session = fixture.core.sessionManager.create(metadata);

    const retrieved = fixture.core.sessionManager.get(session.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(session.id);
    expect(retrieved?.metadata).toEqual(metadata);
  });
});
