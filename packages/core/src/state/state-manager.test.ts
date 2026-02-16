import { describe, it, expect } from "vitest";
import { createStateManager } from "./index.js";
import type { Message } from "@openstarry/sdk";

function makeMessage(role: "user" | "assistant" | "system", text: string): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content: [{ type: "text", text }],
    createdAt: Date.now(),
  };
}

describe("StateManager", () => {
  it("starts with empty messages", () => {
    const sm = createStateManager();
    expect(sm.getMessages()).toEqual([]);
  });

  it("addMessage() appends to history", () => {
    const sm = createStateManager();
    const msg = makeMessage("user", "hello");
    sm.addMessage(msg);

    const messages = sm.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(msg.id);
  });

  it("getMessages() returns a copy (not a reference)", () => {
    const sm = createStateManager();
    sm.addMessage(makeMessage("user", "hello"));

    const msgs1 = sm.getMessages();
    const msgs2 = sm.getMessages();

    expect(msgs1).toEqual(msgs2);
    expect(msgs1).not.toBe(msgs2); // different array references
  });

  it("clear() empties all messages", () => {
    const sm = createStateManager();
    sm.addMessage(makeMessage("user", "a"));
    sm.addMessage(makeMessage("assistant", "b"));

    sm.clear();
    expect(sm.getMessages()).toEqual([]);
  });

  it("snapshot() returns a deep copy", () => {
    const sm = createStateManager();
    const msg = makeMessage("user", "original");
    sm.addMessage(msg);

    const snap = sm.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].content[0]).toEqual({ type: "text", text: "original" });

    // Mutating snapshot should not affect state
    (snap[0].content[0] as { text: string }).text = "mutated";
    const current = sm.getMessages();
    expect((current[0].content[0] as { type: string; text: string }).text).toBe("original");
  });

  it("restore() replaces state with snapshot", () => {
    const sm = createStateManager();
    sm.addMessage(makeMessage("user", "before"));

    const snap = sm.snapshot();

    sm.clear();
    sm.addMessage(makeMessage("user", "after"));

    sm.restore(snap);
    const msgs = sm.getMessages();
    expect(msgs).toHaveLength(1);
    expect((msgs[0].content[0] as { type: string; text: string }).text).toBe("before");
  });

  it("restore() creates a deep copy (modifying original snap does not affect state)", () => {
    const sm = createStateManager();
    sm.addMessage(makeMessage("user", "hello"));

    const snap = sm.snapshot();
    sm.clear();
    sm.restore(snap);

    // Mutate snap after restore
    (snap[0].content[0] as { text: string }).text = "hacked";

    const msgs = sm.getMessages();
    expect((msgs[0].content[0] as { type: string; text: string }).text).toBe("hello");
  });
});
