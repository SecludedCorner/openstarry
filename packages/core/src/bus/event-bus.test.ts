import { describe, it, expect, vi } from "vitest";
import { createEventBus } from "./index.js";
import type { AgentEvent } from "@openstarry/sdk";

function makeEvent(type: string, payload?: unknown): AgentEvent {
  return { type, timestamp: Date.now(), payload };
}

describe("EventBus", () => {
  it("calls handler when matching event is emitted", () => {
    const bus = createEventBus();
    const handler = vi.fn();

    bus.on("test:event", handler);
    const event = makeEvent("test:event", { data: 1 });
    bus.emit(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("does not call handler for non-matching event types", () => {
    const bus = createEventBus();
    const handler = vi.fn();

    bus.on("test:a", handler);
    bus.emit(makeEvent("test:b"));

    expect(handler).not.toHaveBeenCalled();
  });

  it("supports multiple handlers for the same event type", () => {
    const bus = createEventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on("test:event", h1);
    bus.on("test:event", h2);
    bus.emit(makeEvent("test:event"));

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("unsubscribes handler via returned function", () => {
    const bus = createEventBus();
    const handler = vi.fn();

    const unsub = bus.on("test:event", handler);
    bus.emit(makeEvent("test:event"));
    expect(handler).toHaveBeenCalledOnce();

    unsub();
    bus.emit(makeEvent("test:event"));
    expect(handler).toHaveBeenCalledOnce(); // not called again
  });

  it("once() handler fires only once", () => {
    const bus = createEventBus();
    const handler = vi.fn();

    bus.once("test:event", handler);
    bus.emit(makeEvent("test:event"));
    bus.emit(makeEvent("test:event"));

    expect(handler).toHaveBeenCalledOnce();
  });

  it("onAny() receives all events (wildcard)", () => {
    const bus = createEventBus();
    const handler = vi.fn();

    bus.onAny(handler);
    bus.emit(makeEvent("type:a"));
    bus.emit(makeEvent("type:b"));
    bus.emit(makeEvent("type:c"));

    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("onAny() can be unsubscribed", () => {
    const bus = createEventBus();
    const handler = vi.fn();

    const unsub = bus.onAny(handler);
    bus.emit(makeEvent("type:a"));
    unsub();
    bus.emit(makeEvent("type:b"));

    expect(handler).toHaveBeenCalledOnce();
  });

  it("isolates errors — sync handler error does not break other handlers", () => {
    const bus = createEventBus();
    const badHandler = vi.fn(() => {
      throw new Error("boom");
    });
    const goodHandler = vi.fn();

    bus.on("test:event", badHandler);
    bus.on("test:event", goodHandler);

    // Should not throw
    bus.emit(makeEvent("test:event"));

    expect(badHandler).toHaveBeenCalledOnce();
    expect(goodHandler).toHaveBeenCalledOnce();
  });

  it("isolates errors — async handler rejection does not break other handlers", async () => {
    const bus = createEventBus();
    const badHandler = vi.fn(async () => {
      throw new Error("async boom");
    });
    const goodHandler = vi.fn();

    bus.on("test:event", badHandler);
    bus.on("test:event", goodHandler);

    bus.emit(makeEvent("test:event"));

    expect(badHandler).toHaveBeenCalledOnce();
    expect(goodHandler).toHaveBeenCalledOnce();
  });

  it("both type-specific and wildcard handlers are called", () => {
    const bus = createEventBus();
    const specificHandler = vi.fn();
    const wildcardHandler = vi.fn();

    bus.on("test:event", specificHandler);
    bus.onAny(wildcardHandler);

    const event = makeEvent("test:event");
    bus.emit(event);

    expect(specificHandler).toHaveBeenCalledWith(event);
    expect(wildcardHandler).toHaveBeenCalledWith(event);
  });
});
