/**
 * guide-adapter — F-CY32 Option 2 wiring tests.
 *
 * Cycle 03-33 fix per Master Ratification Batch 27 Item #13 +
 * cycle 03-32 R3 §4.4 D-§A6.4 23/0 UNANIMOUS.
 *
 * Verifies:
 *   - Persona prepended as `{ role: "system" }` Message when guide present.
 *   - Persona absent → returns baseMessages unchanged (defensive copy).
 *   - Empty persona string → baseMessages unchanged.
 *   - Persona ordering: system message MUST precede all user/assistant entries.
 *   - Async guide.getSystemPrompt() resolves before adapter returns.
 *   - Persona-bearing system message is a fresh object (no shared identity
 *     across calls — guards against accidental cross-tick mutation).
 */

import { describe, it, expect, vi } from "vitest";
import type { IGuide, Message } from "@openstarry/sdk";
import {
  applyGuideToMessages,
  resolvePersonaAndApply,
} from "../guide-adapter.js";

function userMsg(text: string, id = "u1"): Message {
  return {
    id,
    role: "user",
    content: [{ type: "text", text }],
    createdAt: 1000,
  };
}

function assistantMsg(text: string, id = "a1"): Message {
  return {
    id,
    role: "assistant",
    content: [{ type: "text", text }],
    createdAt: 1100,
  };
}

describe("applyGuideToMessages — F-CY32 Option 2 persona injection", () => {
  it("prepends a system-role Message when persona is non-empty", () => {
    const base = [userMsg("hello")];
    const result = applyGuideToMessages(base, "You are SIGMA-7.", () => 2000);

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("system");
    expect(result[0].content).toEqual([{ type: "text", text: "You are SIGMA-7." }]);
    expect(result[0].createdAt).toBe(2000);
    expect(result[1]).toBe(base[0]);
  });

  it("returns a copy of baseMessages unchanged when persona is undefined", () => {
    const base = [userMsg("hello")];
    const result = applyGuideToMessages(base, undefined);

    expect(result).toEqual(base);
    expect(result).not.toBe(base); // defensive copy
    expect(result[0]).toBe(base[0]); // entries still referentially equal
  });

  it("returns a copy unchanged when persona is empty string", () => {
    const base = [userMsg("hi")];
    const result = applyGuideToMessages(base, "");

    expect(result).toEqual(base);
    expect(result).not.toBe(base);
  });

  it("preserves system-role ordering invariant: persona precedes all user/assistant", () => {
    const base = [
      userMsg("u1", "id-u1"),
      assistantMsg("a1", "id-a1"),
      userMsg("u2", "id-u2"),
    ];
    const result = applyGuideToMessages(base, "PERSONA", () => 1);

    expect(result[0].role).toBe("system");
    expect(result.slice(1).map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    // System message MUST be the only system entry in the array
    expect(result.filter((m) => m.role === "system")).toHaveLength(1);
  });

  it("produces a fresh system-message object on each call (no shared identity)", () => {
    const base = [userMsg("x")];
    const a = applyGuideToMessages(base, "P", () => 1);
    const b = applyGuideToMessages(base, "P", () => 2);

    expect(a[0]).not.toBe(b[0]); // different object references
    expect(a[0].id).not.toBe(b[0].id); // generateId returns fresh ids
  });

  it("does not mutate the input array (caller-safety contract)", () => {
    const base = [userMsg("u")];
    const baseSnapshot = [...base];
    applyGuideToMessages(base, "PERSONA");
    expect(base).toEqual(baseSnapshot);
  });

  it("handles empty baseMessages (system-only conversation start)", () => {
    const result = applyGuideToMessages([], "BOOT_PROMPT", () => 1);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("system");
  });
});

describe("resolvePersonaAndApply — async guide resolution wrapper", () => {
  it("calls guide.getSystemPrompt() and prepends the result", async () => {
    const guide: IGuide = {
      skandha: "vijnana",
      id: "g1",
      name: "G1",
      getSystemPrompt: () => "RESOLVED_PERSONA",
    };
    const base = [userMsg("hi")];
    const result = await resolvePersonaAndApply(base, guide, () => 5);

    expect(result[0].role).toBe("system");
    expect(result[0].content[0]).toEqual({ type: "text", text: "RESOLVED_PERSONA" });
    expect(result[0].createdAt).toBe(5);
  });

  it("awaits async getSystemPrompt() before returning", async () => {
    const getSystemPrompt = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return "ASYNC_PERSONA";
    });
    const guide: IGuide = {
      skandha: "vijnana",
      id: "g2",
      name: "G2",
      getSystemPrompt,
    };

    const result = await resolvePersonaAndApply([], guide);
    expect(getSystemPrompt).toHaveBeenCalledTimes(1);
    expect(result[0].content[0]).toEqual({ type: "text", text: "ASYNC_PERSONA" });
  });

  it("returns baseMessages copy unchanged when no guide is provided", async () => {
    const base = [userMsg("u")];
    const result = await resolvePersonaAndApply(base, undefined);
    expect(result).toEqual(base);
    expect(result).not.toBe(base);
  });

  it("respects guide returning empty string (no system message prepended)", async () => {
    const guide: IGuide = {
      skandha: "vijnana",
      id: "g3",
      name: "G3",
      getSystemPrompt: () => "",
    };
    const base = [userMsg("u")];
    const result = await resolvePersonaAndApply(base, guide);
    expect(result).toEqual(base);
  });
});
