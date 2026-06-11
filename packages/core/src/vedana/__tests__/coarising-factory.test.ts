/**
 * Tests for CoarisingBundle factory.
 * @see vedana/coarising-factory.ts
 */
import { describe, it, expect } from "vitest";
import { createCoarisingBundle, isSahajaValid } from "../coarising-factory.js";
import type { CoarisingBundleInput } from "../coarising-factory.js";

function makeInput(overrides: Partial<CoarisingBundleInput> = {}): CoarisingBundleInput {
  return {
    sparsha: { root: "mano", object: { type: "user_input" }, consciousness: "vijnana" },
    vedana: { valence: 0.5, intensity: 0.7, type: "sukha", source: "mano" },
    samjna: { label: "user-request", confidence: 0.9 },
    cetana: { intention: "respond", urgency: 0.6 },
    manasikara: { focus: "current-task", intensity: 0.8 },
    layer: 1,
    mode: "fast",
    ...overrides,
  };
}

describe("createCoarisingBundle", () => {
  it("assembles a valid bundle with all 5 universals", () => {
    const bundle = createCoarisingBundle(makeInput());
    expect(bundle.sparsha.root).toBe("mano");
    expect(bundle.vedana.valence).toBe(0.5);
    expect(bundle.samjna.label).toBe("user-request");
    expect(bundle.cetana.intention).toBe("respond");
    expect(bundle.manasikara.focus).toBe("current-task");
  });

  it("sets layer and mode correctly", () => {
    const bundle1 = createCoarisingBundle(makeInput({ layer: 1, mode: "fast" }));
    expect(bundle1.layer).toBe(1);
    expect(bundle1.mode).toBe("fast");

    const bundle2 = createCoarisingBundle(makeInput({ layer: 2, mode: "slow" }));
    expect(bundle2.layer).toBe(2);
    expect(bundle2.mode).toBe("slow");
  });

  it("includes a timestamp", () => {
    const before = Date.now();
    const bundle = createCoarisingBundle(makeInput());
    const after = Date.now();
    expect(bundle.timestamp).toBeGreaterThanOrEqual(before);
    expect(bundle.timestamp).toBeLessThanOrEqual(after);
  });

  it("computes SahajaContract with mutual consistency", () => {
    const bundle = createCoarisingBundle(makeInput());
    expect(bundle.sahaja.mutualConsistency).toBe(true);
    expect(bundle.sahaja.atomicPublication).toBe(true);
    expect(bundle.sahaja.stalenessUpperBound).toBeGreaterThanOrEqual(0);
  });

  it("bundle is frozen (immutable)", () => {
    const bundle = createCoarisingBundle(makeInput());
    expect(Object.isFrozen(bundle)).toBe(true);
  });

  it("computes staleness from component timestamps", () => {
    const now = Date.now();
    const bundle = createCoarisingBundle(makeInput({
      componentTimestamps: [now - 30, now - 10, now],
    }));
    expect(bundle.sahaja.stalenessUpperBound).toBe(30);
  });

  it("has zero staleness when no component timestamps", () => {
    const bundle = createCoarisingBundle(makeInput());
    expect(bundle.sahaja.stalenessUpperBound).toBe(0);
  });
});

describe("isSahajaValid", () => {
  it("returns true for valid sahaja within default staleness", () => {
    const bundle = createCoarisingBundle(makeInput());
    expect(isSahajaValid(bundle.sahaja)).toBe(true);
  });

  it("returns false when staleness exceeds max", () => {
    const now = Date.now();
    const bundle = createCoarisingBundle(makeInput({
      componentTimestamps: [now - 100, now],
    }));
    expect(isSahajaValid(bundle.sahaja, 50)).toBe(false);
  });

  it("returns true with custom max staleness", () => {
    const now = Date.now();
    const bundle = createCoarisingBundle(makeInput({
      componentTimestamps: [now - 100, now],
    }));
    expect(isSahajaValid(bundle.sahaja, 200)).toBe(true);
  });
});
