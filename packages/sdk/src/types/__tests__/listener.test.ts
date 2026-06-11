import { describe, it, expect } from "vitest";
import type {
  IListener,
  ITypedListener,
  SenseType,
  IVisualListener,
  AnyListener,
} from "../../index.js";
import type { PluginHooks } from "../../index.js";

describe("C9 — Typed listener interfaces (AC-6, Plan37)", () => {
  describe("SenseType", () => {
    it("accepts all 6 sense type values", () => {
      const values: SenseType[] = [
        'caksur',
        'srotra',
        'ghana',
        'jihva',
        'kaya',
        'mano',
      ];
      expect(values).toHaveLength(6);
      for (const v of values) {
        expect(typeof v).toBe("string");
      }
    });
  });

  describe("ITypedListener", () => {
    it("satisfies the IListener shape (structural compatibility)", () => {
      const typed: ITypedListener = {
        skandha: "rupa",
        id: "listener-1",
        name: "visual-listener",
        senseType: "caksur",
      };
      // Assignable to IListener as well (structural subtype)
      const asBase: IListener = typed;
      expect(asBase.id).toBe("listener-1");
      expect(asBase.name).toBe("visual-listener");
    });

    it("requires senseType field", () => {
      const typed: ITypedListener = {
        skandha: "rupa",
        id: "listener-2",
        name: "auditory-listener",
        senseType: "srotra",
      };
      expect(typed.senseType).toBe("srotra");
    });
  });

  describe("Concrete sub-interfaces", () => {
    it("IVisualListener has senseType caksur", () => {
      const visual: IVisualListener = {
        skandha: "rupa",
        id: "visual-1",
        name: "camera",
        senseType: "caksur",
      };
      expect(visual.senseType).toBe("caksur");
    });
  });

  describe("AnyListener union", () => {
    it("accepts an ITypedListener", () => {
      const typed: ITypedListener = {
        skandha: "rupa",
        id: "l1",
        name: "typed",
        senseType: "mano",
      };
      const any: AnyListener = typed;
      expect(any.id).toBe("l1");
    });

    it("accepts a plain IListener (no senseType)", () => {
      const plain: IListener = {
        skandha: "rupa",
        id: "l2",
        name: "plain",
      };
      const any: AnyListener = plain;
      expect(any.id).toBe("l2");
    });
  });

  describe("PluginHooks.listeners backward compatibility", () => {
    it("accepts a mixed array of typed and untyped listeners", () => {
      const typed: ITypedListener = {
        skandha: "rupa",
        id: "t1",
        name: "typed-listener",
        senseType: "kaya",
      };
      const plain: IListener = {
        skandha: "rupa",
        id: "p1",
        name: "plain-listener",
      };
      const hooks: PluginHooks = {
        listeners: [typed, plain],
      };
      expect(hooks.listeners).toHaveLength(2);
    });

    it("accepts array of only untyped listeners (backward compat)", () => {
      const plain: IListener = {
        skandha: "rupa",
        id: "p2",
        name: "legacy-listener",
      };
      const hooks: PluginHooks = {
        listeners: [plain],
      };
      expect(hooks.listeners).toHaveLength(1);
    });
  });
});
