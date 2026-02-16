import { describe, it, expect } from "vitest";
import { createEventQueue } from "./queue.js";
import type { AgentEvent } from "@openstarry/sdk";

function makeEvent(type: string, seq?: number): AgentEvent {
  return { type, timestamp: Date.now(), payload: { seq } };
}

describe("EventQueue", () => {
  it("delivers events in FIFO order", async () => {
    const queue = createEventQueue();

    queue.push(makeEvent("a", 1));
    queue.push(makeEvent("b", 2));
    queue.push(makeEvent("c", 3));

    const e1 = await queue.pull();
    const e2 = await queue.pull();
    const e3 = await queue.pull();

    expect(e1.type).toBe("a");
    expect(e2.type).toBe("b");
    expect(e3.type).toBe("c");
  });

  it("pull() waits when buffer is empty", async () => {
    const queue = createEventQueue();

    // Start pulling (should block)
    const pullPromise = queue.pull();

    // Push after a delay
    setTimeout(() => queue.push(makeEvent("delayed", 42)), 10);

    const event = await pullPromise;
    expect(event.type).toBe("delayed");
    expect((event.payload as { seq: number }).seq).toBe(42);
  });

  it("push() delivers immediately when pull() is waiting", async () => {
    const queue = createEventQueue();

    const pullPromise = queue.pull();
    queue.push(makeEvent("immediate"));

    const event = await pullPromise;
    expect(event.type).toBe("immediate");
  });

  it("clear() empties the buffer", async () => {
    const queue = createEventQueue();

    queue.push(makeEvent("a"));
    queue.push(makeEvent("b"));
    queue.clear();

    // Now push a new event — pull should get this one
    queue.push(makeEvent("c"));
    const event = await queue.pull();
    expect(event.type).toBe("c");
  });

  it("handles concurrent push/pull correctly", async () => {
    const queue = createEventQueue();
    const results: string[] = [];

    // Start multiple pulls
    const p1 = queue.pull().then((e) => results.push(e.type));

    // Push events
    queue.push(makeEvent("first"));
    queue.push(makeEvent("second"));

    await p1;
    const e2 = await queue.pull();
    results.push(e2.type);

    expect(results).toEqual(["first", "second"]);
  });

  it("handles 1000 events in correct FIFO order (stress test)", async () => {
    const queue = createEventQueue();
    const count = 1000;

    for (let i = 0; i < count; i++) {
      queue.push(makeEvent(`event-${i}`, i));
    }

    for (let i = 0; i < count; i++) {
      const event = await queue.pull();
      expect(event.type).toBe(`event-${i}`);
      expect((event.payload as { seq: number }).seq).toBe(i);
    }
  });

  it("interleaved push/pull maintains order", async () => {
    const queue = createEventQueue();
    const received: number[] = [];

    queue.push(makeEvent("e", 0));
    queue.push(makeEvent("e", 1));

    received.push((await queue.pull()).payload as unknown as number);

    queue.push(makeEvent("e", 2));

    received.push((await queue.pull()).payload as unknown as number);
    received.push((await queue.pull()).payload as unknown as number);

    // payload is { seq: N }, extract seq
    // Actually the payload is { seq: N }, let me fix
    expect(received.map((r) => (r as unknown as { seq: number }).seq)).toEqual([
      0, 1, 2,
    ]);
  });
});
