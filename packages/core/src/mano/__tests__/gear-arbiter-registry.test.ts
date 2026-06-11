/**
 * Tests for GearArbiterRegistry.
 * @see mano/gear-arbiter-registry.ts
 */
import { describe, it, expect } from "vitest";
import { createGearArbiterRegistry } from "../gear-arbiter-registry.js";
import type { IGearArbiter } from "@openstarry/sdk";

function makeArbiter(id: string, priority: number): IGearArbiter {
  return {
    id,
    priority,
    evaluate: () => ({ action: 'abstain' as const, confidence: 0 }),
  };
}

describe("GearArbiterRegistry", () => {
  it("registers and retrieves an arbiter by id", () => {
    const registry = createGearArbiterRegistry();
    const arbiter = makeArbiter("a1", 10);
    registry.register(arbiter);
    expect(registry.get("a1")).toBe(arbiter);
  });

  it("returns undefined for unknown id", () => {
    const registry = createGearArbiterRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("replaces existing arbiter with same id", () => {
    const registry = createGearArbiterRegistry();
    const a1 = makeArbiter("a1", 10);
    const a1v2 = makeArbiter("a1", 5);
    registry.register(a1);
    registry.register(a1v2);
    expect(registry.get("a1")).toBe(a1v2);
    expect(registry.list()).toHaveLength(1);
  });

  it("lists arbiters in insertion order", () => {
    const registry = createGearArbiterRegistry();
    registry.register(makeArbiter("b", 20));
    registry.register(makeArbiter("a", 10));
    registry.register(makeArbiter("c", 30));
    expect(registry.list().map(a => a.id)).toEqual(["b", "a", "c"]);
  });

  it("listSorted returns arbiters by priority ascending", () => {
    const registry = createGearArbiterRegistry();
    registry.register(makeArbiter("b", 20));
    registry.register(makeArbiter("a", 10));
    registry.register(makeArbiter("c", 30));
    expect(registry.listSorted().map(a => a.id)).toEqual(["a", "b", "c"]);
  });

  it("listSorted uses FIFO tie-break for same priority", () => {
    const registry = createGearArbiterRegistry();
    registry.register(makeArbiter("first", 10));
    registry.register(makeArbiter("second", 10));
    registry.register(makeArbiter("third", 10));
    expect(registry.listSorted().map(a => a.id)).toEqual(["first", "second", "third"]);
  });

  it("removes an arbiter by id", () => {
    const registry = createGearArbiterRegistry();
    registry.register(makeArbiter("a1", 10));
    expect(registry.remove("a1")).toBe(true);
    expect(registry.get("a1")).toBeUndefined();
    expect(registry.list()).toHaveLength(0);
  });

  it("remove returns false for unknown id", () => {
    const registry = createGearArbiterRegistry();
    expect(registry.remove("nonexistent")).toBe(false);
  });
});
