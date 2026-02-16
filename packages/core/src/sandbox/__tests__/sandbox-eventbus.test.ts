import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { attachRpcHandler, type RpcHandlerDeps, type SubscriptionState } from "../rpc-handler.js";
import type { AgentEvent, ISession } from "@openstarry/sdk";

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

describe("Sandbox Bidirectional EventBus", () => {
  let deps: RpcHandlerDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("BUS_SUBSCRIBE adds subscription to state", () => {
    const { worker, emitter } = createMockWorker();
    const subscriptionState: SubscriptionState = { subscriptions: new Map() };
    attachRpcHandler(worker, "test-plugin", deps, subscriptionState);

    emitter.emit("message", {
      type: "BUS_SUBSCRIBE",
      payload: { eventType: "tool:result", subscriptionId: "sub-1" },
    });

    expect(subscriptionState.subscriptions.has("tool:result")).toBe(true);
    expect(subscriptionState.subscriptions.get("tool:result")!.has("sub-1")).toBe(true);
  });

  it("BUS_UNSUBSCRIBE removes subscription from state", () => {
    const { worker, emitter } = createMockWorker();
    const subscriptionState: SubscriptionState = { subscriptions: new Map() };
    subscriptionState.subscriptions.set("tool:result", new Set(["sub-1", "sub-2"]));
    attachRpcHandler(worker, "test-plugin", deps, subscriptionState);

    emitter.emit("message", {
      type: "BUS_UNSUBSCRIBE",
      payload: { eventType: "tool:result", subscriptionId: "sub-1" },
    });

    expect(subscriptionState.subscriptions.get("tool:result")!.has("sub-1")).toBe(false);
    expect(subscriptionState.subscriptions.get("tool:result")!.has("sub-2")).toBe(true);
  });

  it("BUS_UNSUBSCRIBE cleans up empty sets", () => {
    const { worker, emitter } = createMockWorker();
    const subscriptionState: SubscriptionState = { subscriptions: new Map() };
    subscriptionState.subscriptions.set("tool:result", new Set(["sub-1"]));
    attachRpcHandler(worker, "test-plugin", deps, subscriptionState);

    emitter.emit("message", {
      type: "BUS_UNSUBSCRIBE",
      payload: { eventType: "tool:result", subscriptionId: "sub-1" },
    });

    expect(subscriptionState.subscriptions.has("tool:result")).toBe(false);
  });

  it("supports wildcard '*' subscriptions", () => {
    const { worker, emitter } = createMockWorker();
    const subscriptionState: SubscriptionState = { subscriptions: new Map() };
    attachRpcHandler(worker, "test-plugin", deps, subscriptionState);

    emitter.emit("message", {
      type: "BUS_SUBSCRIBE",
      payload: { eventType: "*", subscriptionId: "wild-1" },
    });

    expect(subscriptionState.subscriptions.has("*")).toBe(true);
    expect(subscriptionState.subscriptions.get("*")!.has("wild-1")).toBe(true);
  });

  it("multiple subscriptions to same event type are tracked", () => {
    const { worker, emitter } = createMockWorker();
    const subscriptionState: SubscriptionState = { subscriptions: new Map() };
    attachRpcHandler(worker, "test-plugin", deps, subscriptionState);

    emitter.emit("message", {
      type: "BUS_SUBSCRIBE",
      payload: { eventType: "tool:result", subscriptionId: "sub-1" },
    });
    emitter.emit("message", {
      type: "BUS_SUBSCRIBE",
      payload: { eventType: "tool:result", subscriptionId: "sub-2" },
    });

    expect(subscriptionState.subscriptions.get("tool:result")!.size).toBe(2);
  });

  it("ignores BUS_SUBSCRIBE without subscriptionState", () => {
    const { worker, emitter } = createMockWorker();
    // No subscriptionState passed
    attachRpcHandler(worker, "test-plugin", deps);

    // Should not throw
    emitter.emit("message", {
      type: "BUS_SUBSCRIBE",
      payload: { eventType: "tool:result", subscriptionId: "sub-1" },
    });

    // No crash = pass
    expect(deps.bus.emit).not.toHaveBeenCalled();
  });

  it("BUS_UNSUBSCRIBE on non-existent event type is safe", () => {
    const { worker, emitter } = createMockWorker();
    const subscriptionState: SubscriptionState = { subscriptions: new Map() };
    attachRpcHandler(worker, "test-plugin", deps, subscriptionState);

    // Should not throw
    emitter.emit("message", {
      type: "BUS_UNSUBSCRIBE",
      payload: { eventType: "nonexistent", subscriptionId: "sub-1" },
    });

    expect(subscriptionState.subscriptions.size).toBe(0);
  });

  it("clearing subscriptions removes all entries for a worker", () => {
    const subscriptionState: SubscriptionState = { subscriptions: new Map() };
    subscriptionState.subscriptions.set("tool:result", new Set(["sub-1"]));
    subscriptionState.subscriptions.set("loop:started", new Set(["sub-2"]));
    subscriptionState.subscriptions.set("*", new Set(["sub-3"]));

    // Simulate cleanup on worker crash
    subscriptionState.subscriptions.clear();

    expect(subscriptionState.subscriptions.size).toBe(0);
  });
});
