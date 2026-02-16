import { describe, it, expect } from "vitest";
import { createContextManager } from "./context.js";
import type { Message } from "@openstarry/sdk";

function msg(role: "user" | "assistant" | "system" | "tool", text: string): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content: [{ type: "text", text }],
    createdAt: Date.now(),
  };
}

describe("ContextManager", () => {
  it("returns empty array for empty input", () => {
    const cm = createContextManager();
    expect(cm.assembleContext([], 5)).toEqual([]);
  });

  it("returns all messages when within window", () => {
    const cm = createContextManager();
    const messages = [msg("user", "hi"), msg("assistant", "hello")];

    const result = cm.assembleContext(messages, 5);
    expect(result).toHaveLength(2);
  });

  it("truncates to maxTurns user messages from the end", () => {
    const cm = createContextManager();
    const messages = [
      msg("user", "turn1"),
      msg("assistant", "resp1"),
      msg("user", "turn2"),
      msg("assistant", "resp2"),
      msg("user", "turn3"),
      msg("assistant", "resp3"),
      msg("user", "turn4"),
      msg("assistant", "resp4"),
    ];

    const result = cm.assembleContext(messages, 2);

    // Should keep last 2 user turns (turn3, turn4) and their responses
    const userTexts = result
      .filter((m) => m.role === "user")
      .map((m) => (m.content[0] as { text: string }).text);

    expect(userTexts).toEqual(["turn3", "turn4"]);
  });

  it("always includes system messages regardless of window", () => {
    const cm = createContextManager();
    const messages = [
      msg("system", "You are helpful"),
      msg("user", "turn1"),
      msg("assistant", "resp1"),
      msg("user", "turn2"),
      msg("assistant", "resp2"),
      msg("user", "turn3"),
      msg("assistant", "resp3"),
    ];

    const result = cm.assembleContext(messages, 1);

    // Should have system + last 1 user turn
    const roles = result.map((m) => m.role);
    expect(roles[0]).toBe("system");

    const userMsgs = result.filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(1);
    expect((userMsgs[0].content[0] as { text: string }).text).toBe("turn3");
  });

  it("maxTurns=0 returns all messages", () => {
    const cm = createContextManager();
    const messages = [
      msg("user", "a"),
      msg("assistant", "b"),
      msg("user", "c"),
      msg("assistant", "d"),
    ];

    const result = cm.assembleContext(messages, 0);
    expect(result).toHaveLength(4);
  });

  it("includes tool messages that fall within the window", () => {
    const cm = createContextManager();
    const messages = [
      msg("user", "old-turn"),
      msg("assistant", "old-resp"),
      msg("user", "recent-turn"),
      msg("assistant", "tool-call"),
      msg("tool", "tool-result"),
      msg("assistant", "final"),
    ];

    const result = cm.assembleContext(messages, 1);

    // Last user turn is "recent-turn", everything after should be included
    const texts = result.map((m) => (m.content[0] as { text: string }).text);
    expect(texts).toContain("recent-turn");
    expect(texts).toContain("tool-call");
    expect(texts).toContain("tool-result");
    expect(texts).toContain("final");
    expect(texts).not.toContain("old-turn");
  });
});
