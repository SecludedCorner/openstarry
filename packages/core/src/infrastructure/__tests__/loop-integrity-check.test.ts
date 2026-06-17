import { describe, it, expect } from "vitest";
import {
  checkLoopIntegrity,
  logLoopIntegrity,
} from "../loop-integrity-check.js";

describe("checkLoopIntegrity (Doc 20 §4 — broken-loop diagnostics)", () => {
  it("healthy loop (providers + listeners) → no diagnostics", () => {
    expect(checkLoopIntegrity({ providerCount: 1, listenerCount: 1 })).toEqual([]);
  });

  it("vegetable (植物人): listeners but no providers → warn", () => {
    const diags = checkLoopIntegrity({ providerCount: 0, listenerCount: 2 });
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("vegetable");
    expect(diags[0].severity).toBe("warn");
    expect(diags[0].message).toMatch(/植物人|vegetable/);
  });

  it("brain-in-vat (缸中之腦): providers but no listeners → warn", () => {
    const diags = checkLoopIntegrity({ providerCount: 3, listenerCount: 0 });
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("brain-in-vat");
    expect(diags[0].message).toMatch(/缸中之腦|brain-in-vat/);
  });

  it("brain-in-vat is suppressed for taskOnly agents", () => {
    expect(checkLoopIntegrity({ providerCount: 3, listenerCount: 0, taskOnly: true })).toEqual([]);
  });

  it("empty agent (no providers, no listeners) → no diagnostics", () => {
    // Nothing wired is not a *broken* loop per these two rules.
    expect(checkLoopIntegrity({ providerCount: 0, listenerCount: 0 })).toEqual([]);
  });

  it("vegetable still fires even with taskOnly (input with no cognition is always wrong)", () => {
    const diags = checkLoopIntegrity({ providerCount: 0, listenerCount: 1, taskOnly: true });
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("vegetable");
  });

  it("logLoopIntegrity logs one warn per diagnostic", () => {
    const warnings: string[] = [];
    const logger = { warn: (msg: string) => warnings.push(msg) };
    // vegetable shape → exactly one warning logged.
    const diags = logLoopIntegrity({ providerCount: 0, listenerCount: 1 }, logger);
    expect(diags).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/vegetable/);
  });

  it("logLoopIntegrity logs nothing for a healthy loop", () => {
    const warnings: string[] = [];
    logLoopIntegrity({ providerCount: 1, listenerCount: 1 }, { warn: (m) => warnings.push(m) });
    expect(warnings).toEqual([]);
  });
});
