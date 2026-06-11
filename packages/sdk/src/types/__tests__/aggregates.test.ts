import { describe, it, expect } from "vitest";
import { isSkandha, hasSkandha } from "../../index.js";
import type { IRupa, IVedana, ISamjna, ISamskara, IVijnana, Skandha } from "../../index.js";

describe("Five Aggregates Root Interfaces", () => {
  it("IRupa has skandha rupa", () => {
    const rupa: IRupa = { skandha: "rupa" };
    expect(rupa.skandha).toBe("rupa");
  });

  it("IVedana has skandha vedana", () => {
    const vedana: IVedana = { skandha: "vedana" };
    expect(vedana.skandha).toBe("vedana");
  });

  it("ISamjna has skandha samjna", () => {
    const samjna: ISamjna = { skandha: "samjna" };
    expect(samjna.skandha).toBe("samjna");
  });

  it("ISamskara has skandha samskara", () => {
    const samskara: ISamskara = { skandha: "samskara" };
    expect(samskara.skandha).toBe("samskara");
  });

  it("IVijnana has skandha vijnana", () => {
    const vijnana: IVijnana = { skandha: "vijnana" };
    expect(vijnana.skandha).toBe("vijnana");
  });

  it("isSkandha type guard works correctly", () => {
    expect(isSkandha({ skandha: "rupa" }, "rupa")).toBe(true);
    expect(isSkandha({ skandha: "vedana" }, "rupa")).toBe(false);
    expect(isSkandha({}, "rupa")).toBe(false);
    expect(isSkandha(null, "rupa")).toBe(false);
    expect(isSkandha("not an object", "rupa")).toBe(false);
  });

  it("Skandha type covers all five aggregates", () => {
    const all: Skandha[] = ["rupa", "vedana", "samjna", "samskara", "vijnana"];
    expect(all).toHaveLength(5);
  });

  describe("hasSkandha", () => {
    it("returns true for matching single skandha", () => {
      expect(hasSkandha({ skandha: "rupa" }, "rupa")).toBe(true);
    });

    it("returns true for matching value in multi-value skandha array", () => {
      expect(hasSkandha({ skandha: ["samskara", "vijnana"] as const }, "samskara")).toBe(true);
    });

    it("returns false when single skandha does not match", () => {
      expect(hasSkandha({ skandha: "rupa" }, "vedana")).toBe(false);
    });

    it("returns false when skandha field is absent", () => {
      expect(hasSkandha({}, "rupa")).toBe(false);
    });

    it("returns false when skandha is undefined", () => {
      expect(hasSkandha({ skandha: undefined }, "rupa")).toBe(false);
    });
  });
});
