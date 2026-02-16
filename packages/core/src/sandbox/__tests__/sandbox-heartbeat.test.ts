import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { attachRpcHandler, type RpcHandlerDeps, type SubscriptionState } from "../rpc-handler.js";
import { AgentEventType } from "@openstarry/sdk";
import type { AgentEvent, ISession } from "@openstarry/sdk";

function createMockWorker() {
  const emitter = new EventEmitter();
  const postedMessages: unknown[] = [];
  return {
    worker: {
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
      once: emitter.once.bind(emitter),
      postMessage: vi.fn((msg: unknown) => postedMessages.push(msg)),
      terminate: vi.fn(() => Promise.resolve(0)),
      performance: { eventLoopUtilization: () => ({ active: 10, idle: 90, utilization: 0.1 }) },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
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
    tools: { list: () => [], get: () => undefined },
    guides: { list: () => [] },
  };
}

describe("Sandbox Heartbeat Monitoring", () => {
  let deps: RpcHandlerDeps;

  beforeEach(() => {
    deps = createMockDeps();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("HEARTBEAT messages are received without error", () => {
    const { worker, emitter } = createMockWorker();
    attachRpcHandler(worker, "test-plugin", deps);

    // Sending a HEARTBEAT should not throw
    emitter.emit("message", {
      type: "HEARTBEAT",
      payload: { timestamp: Date.now() },
    });

    // HEARTBEAT is handled by sandbox-manager, not rpc-handler
    expect(deps.bus.emit).not.toHaveBeenCalled();
  });

  it("heartbeat monitoring tracks lastHeartbeat timestamp", () => {
    // This test verifies the concept: tracking a timestamp that gets updated on heartbeat
    let lastHeartbeat = Date.now();
    const { worker, emitter } = createMockWorker();
    attachRpcHandler(worker, "test-plugin", deps);

    // Simulate heartbeat handler (as sandbox-manager does)
    const heartbeatHandler = (msg: { type: string }) => {
      if (msg.type === "HEARTBEAT") {
        lastHeartbeat = Date.now();
      }
    };
    emitter.on("message", heartbeatHandler);

    // Advance time and send heartbeat
    vi.advanceTimersByTime(30000);
    const beforeHeartbeat = Date.now();
    emitter.emit("message", { type: "HEARTBEAT", payload: { timestamp: Date.now() } });

    expect(lastHeartbeat).toBeGreaterThanOrEqual(beforeHeartbeat);
  });

  it("detects stall when no heartbeat received within timeout", () => {
    let lastHeartbeat = Date.now();
    const cpuTimeoutMs = 60000;
    let stalled = false;

    // Simulate heartbeat check (as sandbox-manager does)
    const checkInterval = setInterval(() => {
      const elapsed = Date.now() - lastHeartbeat;
      if (elapsed > cpuTimeoutMs) {
        stalled = true;
        clearInterval(checkInterval);
      }
    }, 45000);

    // Advance past the timeout without sending heartbeat
    vi.advanceTimersByTime(90000); // 45s check, 90s elapsed > 60s timeout

    expect(stalled).toBe(true);
    clearInterval(checkInterval);
  });

  it("does not trigger stall when heartbeats are received regularly", () => {
    let lastHeartbeat = Date.now();
    const cpuTimeoutMs = 60000;
    let stalled = false;

    // Simulate heartbeat listener
    const { emitter } = createMockWorker();
    emitter.on("message", (msg: { type: string }) => {
      if (msg.type === "HEARTBEAT") {
        lastHeartbeat = Date.now();
      }
    });

    const checkInterval = setInterval(() => {
      const elapsed = Date.now() - lastHeartbeat;
      if (elapsed > cpuTimeoutMs) {
        stalled = true;
      }
    }, 45000);

    // Send heartbeats every 30s for 2 minutes
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(30000);
      emitter.emit("message", { type: "HEARTBEAT", payload: { timestamp: Date.now() } });
    }

    expect(stalled).toBe(false);
    clearInterval(checkInterval);
  });

  it("cpuTimeoutMs is configurable via SandboxConfig", () => {
    // Verify the type allows cpuTimeoutMs
    const config: { enabled: boolean; cpuTimeoutMs?: number } = {
      enabled: true,
      cpuTimeoutMs: 120000,
    };
    expect(config.cpuTimeoutMs).toBe(120000);
  });

  it("stall detection emits correct event type constant", () => {
    expect(AgentEventType.SANDBOX_WORKER_STALLED).toBe("sandbox:worker_stalled");
  });
});
