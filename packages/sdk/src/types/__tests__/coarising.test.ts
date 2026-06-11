/**
 * Tests for CoarisingBundle SDK type extensions (Plan27).
 * @see types/coarising.ts
 */
import { describe, it, expect } from "vitest";
import { fromChannelManasikara } from "../coarising.js";
import type { SparshEvent, ChannelManasikara, ManasikaraDimension } from "../coarising.js";

describe("SparshEvent", () => {
  it("supports optional timestamp field", () => {
    const event: SparshEvent = {
      root: "mano",
      object: { type: "test" },
      consciousness: "vijnana",
      timestamp: 1234567890,
    };
    expect(event.timestamp).toBe(1234567890);
  });

  it("timestamp is optional (backward compat)", () => {
    const event: SparshEvent = {
      root: "eye",
      object: null,
      consciousness: "caksur-vijnana",
    };
    expect(event.timestamp).toBeUndefined();
  });
});

describe("ManasikaraDimension", () => {
  it("fromChannelManasikara converts correctly", () => {
    const manasikara: ChannelManasikara = {
      focus: "tool-result",
      intensity: 0.9,
    };
    const dim: ManasikaraDimension = fromChannelManasikara(manasikara);
    expect(dim.focus).toBe("tool-result");
    expect(dim.intensity).toBe(0.9);
    expect(dim.selectivity).toBe(0.5); // default
    expect(dim.persistenceMs).toBe(0); // default
  });
});
