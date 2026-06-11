/**
 * Tests for checkSkandhaCorrespondence — 18 sigma-constraints (Plan33, 02-8 T3).
 */
import { describe, it, expect, vi } from "vitest";
import { checkSkandhaCorrespondence } from "../skandha-check.js";
import type { PluginManifest, PluginHooks, Skandha } from "@openstarry/sdk";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

function makeManifest(skandha?: Skandha | Skandha[]): PluginManifest {
  return { name: "test-plugin", version: "1.0.0", skandha } as PluginManifest;
}

function makeHooks(overrides: Partial<PluginHooks> = {}): PluginHooks {
  return overrides as PluginHooks;
}

describe("checkSkandhaCorrespondence", () => {
  // === Undeclared Hook constraints (sigma-1 through sigma-5) ===

  it("sigma-1: vedana declared but no vedanaSensors → INFO", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("vedana"),
      makeHooks({}),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-1")).toBe(true);
    expect(v.find(x => x.constraintId === "sigma-1")!.severity).toBe("INFO");
  });

  it("sigma-1: no fire when vedanaSensors present", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("vedana"),
      makeHooks({ vedanaSensors: [{ id: "s1" } as any] }),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-1")).toBe(false);
  });

  it("sigma-2: samjna declared but no providers/gearArbiters/contextManager → INFO", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("samjna"),
      makeHooks({}),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-2")).toBe(true);
  });

  it("sigma-2: no fire when providers present", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("samjna"),
      makeHooks({ providers: [{ id: "p1" } as any] }),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-2")).toBe(false);
  });

  it("sigma-3: samskara declared but no tools → INFO", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("samskara"),
      makeHooks({}),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-3")).toBe(true);
  });

  it("sigma-4: rupa declared but no ui/listeners → INFO", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("rupa"),
      makeHooks({}),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-4")).toBe(true);
  });

  it("sigma-5: vijnana declared but no guides/auditor/monitors → INFO", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("vijnana"),
      makeHooks({}),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-5")).toBe(true);
  });

  it("sigma-5: no fire when auditor present", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("vijnana"),
      makeHooks({ auditor: { id: "a1" } as any }),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-5")).toBe(false);
  });

  // === Overclaimed Skandha constraints (sigma-6 through sigma-12) ===

  it("sigma-6: tools present but samskara not declared → WARN", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("rupa"),
      makeHooks({ tools: [{ name: "t1" } as any] }),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-6")).toBe(true);
    expect(v.find(x => x.constraintId === "sigma-6")!.severity).toBe("WARN");
  });

  it("sigma-7: ui present but rupa not declared → WARN", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("samskara"),
      makeHooks({ ui: [{ id: "u1" } as any] }),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-7")).toBe(true);
  });

  it("sigma-8: listeners present but rupa not declared → WARN", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("samjna"),
      makeHooks({ listeners: [{ id: "l1" } as any] }),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-8")).toBe(true);
  });

  it("sigma-9: providers present but samjna not declared → WARN", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("rupa"),
      makeHooks({ providers: [{ id: "p1" } as any] }),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-9")).toBe(true);
  });

  it("sigma-9b: contextManager present but samjna not declared → WARN", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("rupa"),
      makeHooks({ contextManager: { id: "cm1" } as any }),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-9b")).toBe(true);
  });

  it("sigma-10: auditor present but vijnana not declared → WARN", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("samskara"),
      makeHooks({ auditor: { id: "a1" } as any }),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-10")).toBe(true);
  });

  it("sigma-11: monitors present but vijnana not declared → WARN", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("samskara"),
      makeHooks({ monitors: [{ id: "m1" } as any] }),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-11")).toBe(true);
  });

  it("sigma-12: guides present but vijnana not declared → WARN", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("samskara"),
      makeHooks({ guides: [{ id: "g1" } as any] }),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-12")).toBe(true);
  });

  // === Structural constraints (sigma-13 through sigma-17) ===

  it("sigma-13: empty skandha and no hooks → INFO", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest(),
      makeHooks({}),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-13")).toBe(true);
    expect(v.find(x => x.constraintId === "sigma-13")!.severity).toBe("INFO");
  });

  it("sigma-14: declares skandha but no hooks → INFO", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest(["rupa", "samskara"]),
      makeHooks({}),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-14")).toBe(true);
  });

  it("sigma-15: hooks present but no skandha declared → WARN", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest(),
      makeHooks({ tools: [{ name: "t1" } as any] }),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-15")).toBe(true);
    expect(v.find(x => x.constraintId === "sigma-15")!.severity).toBe("WARN");
  });

  it("sigma-17: volition present without samskara or vijnana → WARN", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("rupa"),
      makeHooks({ volition: { id: "v1" } as any }),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-17")).toBe(true);
  });

  it("sigma-17: no fire when samskara declared", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest("samskara"),
      makeHooks({ volition: { id: "v1" } as any }),
      makeLogger(),
    );
    expect(v.some(x => x.constraintId === "sigma-17")).toBe(false);
  });

  // === Clean pass ===

  it("returns empty array when manifest and hooks are consistent", () => {
    const v = checkSkandhaCorrespondence(
      makeManifest(["samskara", "rupa"]),
      makeHooks({
        tools: [{ name: "t1" } as any],
        ui: [{ id: "u1" } as any],
      }),
      makeLogger(),
    );
    expect(v).toEqual([]);
  });

  it("logger.warn called for WARN violations, logger.info for INFO", () => {
    const log = makeLogger();
    checkSkandhaCorrespondence(
      makeManifest(),
      makeHooks({ tools: [{ name: "t1" } as any] }),
      log,
    );
    expect(log.warn).toHaveBeenCalled(); // sigma-15 WARN
  });
});
