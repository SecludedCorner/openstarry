/**
 * Event Forwarder Tests — Unit tests for event mapping and forwarding logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EventBus, AgentEvent, EventHandler } from "@openstarry/sdk";
import { AgentEventType } from "@openstarry/sdk";
import { initEventForwarder } from "../../src/daemon/event-forwarder.js";
import type { RPCEvent } from "../../src/daemon/types.js";
import type { OutputEvent, ToolEvent, LoopEvent } from "../../src/daemon/attach-types.js";

// Mock IPCServerImpl
class MockIPCServer {
  broadcastToSession = vi.fn();
}

// Mock EventBus
class MockEventBus implements EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private wildcardHandlers: Set<EventHandler> = new Set();

  on(type: string, handler: EventHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  once(type: string, handler: EventHandler): () => void {
    const unsub = this.on(type, handler);
    return unsub;
  }

  onAny(handler: EventHandler): () => void {
    this.wildcardHandlers.add(handler);
    return () => this.wildcardHandlers.delete(handler);
  }

  emit(event: AgentEvent): void {
    const set = this.handlers.get(event.type);
    if (set) {
      for (const handler of set) {
        handler(event);
      }
    }
    for (const handler of this.wildcardHandlers) {
      handler(event);
    }
  }
}

describe("Event Forwarder", () => {
  let bus: MockEventBus;
  let ipcServer: MockIPCServer;
  let unsub: (() => void) | null;

  beforeEach(() => {
    bus = new MockEventBus();
    ipcServer = new MockIPCServer();
    unsub = null;
  });

  afterEach(() => {
    if (unsub) {
      unsub();
    }
  });

  it("should subscribe to event bus with wildcard listener", () => {
    unsub = initEventForwarder(bus as unknown as EventBus, ipcServer as any, "test-agent");
    expect(unsub).toBeTypeOf("function");
  });

  it("should forward STREAM_TEXT_DELTA with sessionId", () => {
    unsub = initEventForwarder(bus as unknown as EventBus, ipcServer as any, "test-agent");

    const event: AgentEvent = {
      type: AgentEventType.STREAM_TEXT_DELTA,
      timestamp: Date.now(),
      payload: {
        text: "Hello",
        metadata: { sessionId: "session1" },
      },
    };

    bus.emit(event);

    expect(ipcServer.broadcastToSession).toHaveBeenCalledTimes(1);
    expect(ipcServer.broadcastToSession).toHaveBeenCalledWith("session1", {
      event: "agent.output",
      data: { sessionId: "session1", text: "Hello", isReasoning: false },
    });
  });

  it("should forward STREAM_REASONING_DELTA with sessionId", () => {
    unsub = initEventForwarder(bus as unknown as EventBus, ipcServer as any, "test-agent");

    const event: AgentEvent = {
      type: AgentEventType.STREAM_REASONING_DELTA,
      timestamp: Date.now(),
      payload: {
        text: "Thinking...",
        metadata: { sessionId: "session2" },
      },
    };

    bus.emit(event);

    expect(ipcServer.broadcastToSession).toHaveBeenCalledWith("session2", {
      event: "agent.output",
      data: { sessionId: "session2", text: "Thinking...", isReasoning: true },
    });
  });

  it("should forward TOOL_EXECUTING as tool started", () => {
    unsub = initEventForwarder(bus as unknown as EventBus, ipcServer as any, "test-agent");

    const event: AgentEvent = {
      type: AgentEventType.TOOL_EXECUTING,
      timestamp: Date.now(),
      payload: {
        name: "search",
        arguments: { query: "test" },
        sessionId: "session3",
      },
    };

    bus.emit(event);

    expect(ipcServer.broadcastToSession).toHaveBeenCalledWith("session3", {
      event: "agent.tool",
      data: {
        sessionId: "session3",
        toolName: "search",
        status: "started",
        args: { query: "test" },
      },
    });
  });

  it("should forward TOOL_RESULT as tool completed", () => {
    unsub = initEventForwarder(bus as unknown as EventBus, ipcServer as any, "test-agent");

    const event: AgentEvent = {
      type: AgentEventType.TOOL_RESULT,
      timestamp: Date.now(),
      payload: {
        name: "search",
        result: "found 10 results",
        sessionId: "session4",
      },
    };

    bus.emit(event);

    expect(ipcServer.broadcastToSession).toHaveBeenCalledWith("session4", {
      event: "agent.tool",
      data: {
        sessionId: "session4",
        toolName: "search",
        status: "completed",
        result: "found 10 results",
      },
    });
  });

  it("should forward TOOL_ERROR as tool failed", () => {
    unsub = initEventForwarder(bus as unknown as EventBus, ipcServer as any, "test-agent");

    const event: AgentEvent = {
      type: AgentEventType.TOOL_ERROR,
      timestamp: Date.now(),
      payload: {
        name: "search",
        error: "API timeout",
        sessionId: "session5",
      },
    };

    bus.emit(event);

    expect(ipcServer.broadcastToSession).toHaveBeenCalledWith("session5", {
      event: "agent.tool",
      data: {
        sessionId: "session5",
        toolName: "search",
        status: "failed",
        error: "API timeout",
      },
    });
  });

  it("should forward LOOP_STARTED", () => {
    unsub = initEventForwarder(bus as unknown as EventBus, ipcServer as any, "test-agent");

    const event: AgentEvent = {
      type: AgentEventType.LOOP_STARTED,
      timestamp: Date.now(),
      payload: { sessionId: "session6" },
    };

    bus.emit(event);

    expect(ipcServer.broadcastToSession).toHaveBeenCalledWith("session6", {
      event: "agent.loop",
      data: { sessionId: "session6", phase: "started" },
    });
  });

  it("should forward LOOP_AWAITING_LLM", () => {
    unsub = initEventForwarder(bus as unknown as EventBus, ipcServer as any, "test-agent");

    const event: AgentEvent = {
      type: AgentEventType.LOOP_AWAITING_LLM,
      timestamp: Date.now(),
      payload: { sessionId: "session7" },
    };

    bus.emit(event);

    expect(ipcServer.broadcastToSession).toHaveBeenCalledWith("session7", {
      event: "agent.loop",
      data: { sessionId: "session7", phase: "awaiting_llm" },
    });
  });

  it("should forward LOOP_FINISHED", () => {
    unsub = initEventForwarder(bus as unknown as EventBus, ipcServer as any, "test-agent");

    const event: AgentEvent = {
      type: AgentEventType.LOOP_FINISHED,
      timestamp: Date.now(),
      payload: { sessionId: "session8" },
    };

    bus.emit(event);

    expect(ipcServer.broadcastToSession).toHaveBeenCalledWith("session8", {
      event: "agent.loop",
      data: { sessionId: "session8", phase: "finished" },
    });
  });

  it("should forward LOOP_ERROR", () => {
    unsub = initEventForwarder(bus as unknown as EventBus, ipcServer as any, "test-agent");

    const event: AgentEvent = {
      type: AgentEventType.LOOP_ERROR,
      timestamp: Date.now(),
      payload: {
        error: "Loop crashed",
        sessionId: "session9",
      },
    };

    bus.emit(event);

    expect(ipcServer.broadcastToSession).toHaveBeenCalledWith("session9", {
      event: "agent.loop",
      data: { sessionId: "session9", phase: "error", error: "Loop crashed" },
    });
  });

  it("should NOT forward events without sessionId", () => {
    unsub = initEventForwarder(bus as unknown as EventBus, ipcServer as any, "test-agent");

    const event: AgentEvent = {
      type: AgentEventType.STREAM_TEXT_DELTA,
      timestamp: Date.now(),
      payload: {
        text: "No session",
      },
    };

    bus.emit(event);

    expect(ipcServer.broadcastToSession).not.toHaveBeenCalled();
  });

  it("should NOT forward irrelevant event types", () => {
    unsub = initEventForwarder(bus as unknown as EventBus, ipcServer as any, "test-agent");

    const event: AgentEvent = {
      type: AgentEventType.AGENT_STARTED,
      timestamp: Date.now(),
      payload: { sessionId: "session10" },
    };

    bus.emit(event);

    expect(ipcServer.broadcastToSession).not.toHaveBeenCalled();
  });

  it("should unsubscribe from event bus when unsub is called", () => {
    unsub = initEventForwarder(bus as unknown as EventBus, ipcServer as any, "test-agent");

    const event: AgentEvent = {
      type: AgentEventType.STREAM_TEXT_DELTA,
      timestamp: Date.now(),
      payload: {
        text: "Before unsub",
        sessionId: "session11",
      },
    };

    bus.emit(event);
    expect(ipcServer.broadcastToSession).toHaveBeenCalledTimes(1);

    // Unsubscribe
    unsub();
    unsub = null;

    // Emit another event
    bus.emit(event);

    // Should still be 1 (no new calls)
    expect(ipcServer.broadcastToSession).toHaveBeenCalledTimes(1);
  });
});
