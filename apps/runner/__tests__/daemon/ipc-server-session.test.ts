/**
 * IPC Server Session Tests — Unit tests for session subscription methods.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { IPCServerImpl } from "../../src/daemon/ipc-server.js";
import type { RPCEvent } from "../../src/daemon/types.js";
import { Socket } from "node:net";

// Mock Socket
class MockSocket extends Socket {
  public destroyed = false;
  public writeCalls: string[] = [];

  write(data: string | Buffer): boolean {
    this.writeCalls.push(data.toString());
    return true;
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

describe("IPC Server Session Subscription", () => {
  let server: IPCServerImpl;
  let mockSocket1: MockSocket;
  let mockSocket2: MockSocket;
  let mockSocket3: MockSocket;

  beforeEach(() => {
    server = new IPCServerImpl({
      socketPath: "/tmp/test-session.sock",
      onRequest: async () => ({ success: true }),
    });

    mockSocket1 = new MockSocket();
    mockSocket2 = new MockSocket();
    mockSocket3 = new MockSocket();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("should subscribe a socket to a session", () => {
    server.subscribeSession(mockSocket1, "session1");

    const event: RPCEvent = { event: "agent.output", data: { sessionId: "session1", text: "Hello" } };
    server.broadcastToSession("session1", event);

    expect(mockSocket1.writeCalls).toHaveLength(1);
    expect(mockSocket1.writeCalls[0]).toContain("agent.output");
  });

  it("should broadcast to multiple subscribers of the same session", () => {
    server.subscribeSession(mockSocket1, "session1");
    server.subscribeSession(mockSocket2, "session1");

    const event: RPCEvent = { event: "agent.output", data: { sessionId: "session1", text: "Hello" } };
    server.broadcastToSession("session1", event);

    expect(mockSocket1.writeCalls).toHaveLength(1);
    expect(mockSocket2.writeCalls).toHaveLength(1);
  });

  it("should NOT broadcast to sockets subscribed to different sessions", () => {
    server.subscribeSession(mockSocket1, "session1");
    server.subscribeSession(mockSocket2, "session2");

    const event: RPCEvent = { event: "agent.output", data: { sessionId: "session1", text: "Hello" } };
    server.broadcastToSession("session1", event);

    expect(mockSocket1.writeCalls).toHaveLength(1);
    expect(mockSocket2.writeCalls).toHaveLength(0);
  });

  it("should unsubscribe a socket from a session", () => {
    server.subscribeSession(mockSocket1, "session1");
    server.unsubscribeSession(mockSocket1, "session1");

    const event: RPCEvent = { event: "agent.output", data: { sessionId: "session1", text: "Hello" } };
    server.broadcastToSession("session1", event);

    expect(mockSocket1.writeCalls).toHaveLength(0);
  });

  it("should handle multiple subscriptions for the same socket", () => {
    server.subscribeSession(mockSocket1, "session1");
    server.subscribeSession(mockSocket1, "session2");

    const event1: RPCEvent = { event: "agent.output", data: { sessionId: "session1", text: "Hello" } };
    const event2: RPCEvent = { event: "agent.output", data: { sessionId: "session2", text: "World" } };

    server.broadcastToSession("session1", event1);
    server.broadcastToSession("session2", event2);

    expect(mockSocket1.writeCalls).toHaveLength(2);
    expect(mockSocket1.writeCalls[0]).toContain("session1");
    expect(mockSocket1.writeCalls[1]).toContain("session2");
  });

  it("should NOT send to destroyed sockets", () => {
    server.subscribeSession(mockSocket1, "session1");
    mockSocket1.destroyed = true;

    const event: RPCEvent = { event: "agent.output", data: { sessionId: "session1", text: "Hello" } };
    server.broadcastToSession("session1", event);

    expect(mockSocket1.writeCalls).toHaveLength(0);
  });

  it("should do nothing when broadcasting to non-existent session", () => {
    const event: RPCEvent = { event: "agent.output", data: { sessionId: "nonexistent", text: "Hello" } };
    server.broadcastToSession("nonexistent", event);

    // No error should be thrown
    expect(mockSocket1.writeCalls).toHaveLength(0);
  });

  it("should handle unsubscribe from non-subscribed session gracefully", () => {
    server.unsubscribeSession(mockSocket1, "nonexistent");

    // No error should be thrown
    const event: RPCEvent = { event: "agent.output", data: { sessionId: "session1", text: "Hello" } };
    server.broadcastToSession("session1", event);

    expect(mockSocket1.writeCalls).toHaveLength(0);
  });

  it("should clean up empty session subscription sets", () => {
    server.subscribeSession(mockSocket1, "session1");
    server.unsubscribeSession(mockSocket1, "session1");

    // Session should be removed from internal map (tested indirectly)
    const event: RPCEvent = { event: "agent.output", data: { sessionId: "session1", text: "Hello" } };
    server.broadcastToSession("session1", event);

    expect(mockSocket1.writeCalls).toHaveLength(0);
  });

  it("should broadcast to correct subscribers when mixed sessions", () => {
    server.subscribeSession(mockSocket1, "session1");
    server.subscribeSession(mockSocket2, "session1");
    server.subscribeSession(mockSocket3, "session2");

    const event1: RPCEvent = { event: "agent.output", data: { sessionId: "session1", text: "Hello" } };
    const event2: RPCEvent = { event: "agent.output", data: { sessionId: "session2", text: "World" } };

    server.broadcastToSession("session1", event1);
    server.broadcastToSession("session2", event2);

    expect(mockSocket1.writeCalls).toHaveLength(1);
    expect(mockSocket2.writeCalls).toHaveLength(1);
    expect(mockSocket3.writeCalls).toHaveLength(1);

    expect(mockSocket1.writeCalls[0]).toContain("session1");
    expect(mockSocket2.writeCalls[0]).toContain("session1");
    expect(mockSocket3.writeCalls[0]).toContain("session2");
  });
});
