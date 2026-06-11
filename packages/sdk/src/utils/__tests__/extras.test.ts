/**
 * Tests for extras SDK helpers.
 * @see utils/extras.ts
 */
import { describe, it, expect, vi } from "vitest";
import {
  isValidExtrasKey,
  getExtra,
  emitWithExtras,
  EXTRAS_MAX_KEYS,
  EXTRAS_MAX_KEY_LENGTH,
} from "../extras.js";
import type { EventBus, AgentEvent } from "../../types/events.js";

function makeBus(): { bus: EventBus; emitted: AgentEvent[] } {
  const emitted: AgentEvent[] = [];
  const bus: EventBus = {
    on: vi.fn(() => () => {}),
    once: vi.fn(() => () => {}),
    onAny: vi.fn(() => () => {}),
    emit: vi.fn((event: AgentEvent) => { emitted.push(event); }),
  };
  return { bus, emitted };
}

describe("isValidExtrasKey", () => {
  it("valid key accepted", () => {
    expect(isValidExtrasKey("loopQuality:score", 0)).toBe(true);
  });

  it("audit: prefix rejected (WIENER C-3)", () => {
    expect(isValidExtrasKey("audit:log", 0)).toBe(false);
  });

  it("core: prefix rejected", () => {
    expect(isValidExtrasKey("core:version", 0)).toBe(false);
  });

  it("internal: prefix rejected", () => {
    expect(isValidExtrasKey("internal:id", 0)).toBe(false);
  });

  it("key length limit: 129-char key → false", () => {
    const longKey = "a".repeat(EXTRAS_MAX_KEY_LENGTH + 1);
    expect(isValidExtrasKey(longKey, 0)).toBe(false);
  });

  it("key at max length (128 chars) → true", () => {
    const maxKey = "a".repeat(EXTRAS_MAX_KEY_LENGTH);
    expect(isValidExtrasKey(maxKey, 0)).toBe(true);
  });

  it("max keys limit: currentSize=32 → false", () => {
    expect(isValidExtrasKey("myKey", EXTRAS_MAX_KEYS)).toBe(false);
  });

  it("currentSize below max → true", () => {
    expect(isValidExtrasKey("myKey", EXTRAS_MAX_KEYS - 1)).toBe(true);
  });
});

describe("getExtra", () => {
  it("getExtra returns value when type guard passes (Record)", () => {
    const extras: Record<string, unknown> = { score: 0.9 };
    const isNumber = (v: unknown): v is number => typeof v === "number";
    expect(getExtra(extras, "score", isNumber)).toBe(0.9);
  });

  it("getExtra returns undefined when type guard fails", () => {
    const extras: Record<string, unknown> = { score: "not-a-number" };
    const isNumber = (v: unknown): v is number => typeof v === "number";
    expect(getExtra(extras, "score", isNumber)).toBeUndefined();
  });

  it("getExtra handles undefined extras: returns undefined", () => {
    const isNumber = (v: unknown): v is number => typeof v === "number";
    expect(getExtra(undefined, "score", isNumber)).toBeUndefined();
  });

  it("getExtra works with Map", () => {
    const extras = new Map<string, unknown>([["quality", 0.8]]);
    const isNumber = (v: unknown): v is number => typeof v === "number";
    expect(getExtra(extras, "quality", isNumber)).toBe(0.8);
  });

  it("getExtra returns undefined for missing key in Map", () => {
    const extras = new Map<string, unknown>([["other", 1]]);
    const isNumber = (v: unknown): v is number => typeof v === "number";
    expect(getExtra(extras, "quality", isNumber)).toBeUndefined();
  });
});

describe("emitWithExtras", () => {
  it("emitWithExtras emits event with extras field populated", () => {
    const { bus, emitted } = makeBus();
    const base: Omit<AgentEvent, "extras"> = {
      type: "loop:finished",
      timestamp: 1000,
    };
    emitWithExtras(bus, base, [{ key: "loopQuality:score", value: 0.75 }]);

    expect(emitted).toHaveLength(1);
    const event = emitted[0];
    expect((event as AgentEvent & { extras?: Record<string, unknown> }).extras).toBeDefined();
    expect((event as AgentEvent & { extras?: Record<string, unknown> }).extras!["loopQuality:score"]).toBe(0.75);
  });

  it("emitWithExtras drops banned keys: audit: key absent from emitted event.extras", () => {
    const { bus, emitted } = makeBus();
    const base: Omit<AgentEvent, "extras"> = {
      type: "loop:finished",
      timestamp: 2000,
    };
    emitWithExtras(bus, base, [
      { key: "audit:log", value: "secret" },
      { key: "plugin:data", value: 42 },
    ]);

    expect(emitted).toHaveLength(1);
    const extras = (emitted[0] as AgentEvent & { extras?: Record<string, unknown> }).extras;
    expect(extras).toBeDefined();
    expect(extras!["audit:log"]).toBeUndefined();
    expect(extras!["plugin:data"]).toBe(42);
  });

  it("emitWithExtras emits event with undefined extras when all keys are invalid", () => {
    const { bus, emitted } = makeBus();
    const base: Omit<AgentEvent, "extras"> = {
      type: "loop:finished",
      timestamp: 3000,
    };
    emitWithExtras(bus, base, [
      { key: "audit:secret", value: "x" },
      { key: "core:version", value: "1.0" },
    ]);

    expect(emitted).toHaveLength(1);
    const extras = (emitted[0] as AgentEvent & { extras?: Record<string, unknown> }).extras;
    expect(extras).toBeUndefined();
  });
});
