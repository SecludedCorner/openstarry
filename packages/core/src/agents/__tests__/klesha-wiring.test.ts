/**
 * createKleshaSignalFn wiring tests (FIX-2026-06-11 repair sprint).
 *
 * Before this fix, getKleshaSignals at the volition-deps layer was hardcoded
 * to neutral zeros (agent-core), so the Doc 37 klesha gain-scheduling
 * machinery never received live signals. These tests verify the wiring
 * produces real, input-sensitive signals from the four Plan26 perceivers.
 */

import { describe, it, expect } from "vitest";
import type { ChannelVedana, VedanaAssessment } from "@openstarry/sdk";
import { createKleshaSignalFn } from "../agent-core.js";
import { createDefaultKleshas } from "../../vijnana/klesha.js";

function assessmentOf(valence: number, intensity = 0.8): VedanaAssessment {
  const aggregate: ChannelVedana = {
    valence,
    intensity,
    type: valence > 0.3 ? "sukha" : valence < -0.3 ? "dukkha" : "upekkha",
    source: "test",
  };
  return { aggregate, channels: [aggregate], pidOutput: valence * intensity, timestamp: 1 };
}

describe("createKleshaSignalFn (FIX-2026-06-11)", () => {
  it("returns a full bundle with all values in [0, 1]", () => {
    const fn = createKleshaSignalFn(
      createDefaultKleshas(),
      () => assessmentOf(0),
      [],
    );
    const bundle = fn();
    for (const key of ["moha", "drishti", "mana", "sneha"] as const) {
      expect(bundle[key]).toBeGreaterThanOrEqual(0);
      expect(bundle[key]).toBeLessThanOrEqual(1);
    }
  });

  it("is NOT the old hardcoded all-zeros stub under sustained non-neutral input", () => {
    const valences = [0.9, -0.9, 0.9, -0.9, 0.9, -0.9, 0.9, -0.9, 0.9, -0.9];
    let i = 0;
    const fn = createKleshaSignalFn(
      createDefaultKleshas(),
      () => assessmentOf(valences[i++ % valences.length]),
      ["fs.read", "fs.read", "fs.read", "fs.read", "fs.read"],
    );
    let bundle = fn();
    for (let n = 0; n < 9; n++) bundle = fn();
    const sum = bundle.moha + bundle.drishti + bundle.mana + bundle.sneha;
    expect(sum).toBeGreaterThan(0);
  });

  it("moha is high under constant-magnitude vedana (numbness) and lower when magnitudes vary", () => {
    // Moha = low-pass over (1 - variance(|valence|) * scale): a system whose
    // feeling MAGNITUDE never changes is "ignorant of change" → high moha;
    // varied magnitudes → awareness → lower moha.
    const constantMagnitude = createKleshaSignalFn(
      createDefaultKleshas(),
      () => assessmentOf(0.9),
      [],
    );
    const variedMagnitude = createKleshaSignalFn(
      createDefaultKleshas(),
      (() => {
        const seq = [0.9, 0.05, 0.8, 0.1, 0.95, 0.0];
        let i = 0;
        return () => assessmentOf(seq[i++ % seq.length]);
      })(),
      [],
    );
    let constBundle = constantMagnitude();
    let variedBundle = variedMagnitude();
    for (let n = 0; n < 11; n++) {
      constBundle = constantMagnitude();
      variedBundle = variedMagnitude();
    }
    expect(constBundle.moha).toBeGreaterThan(variedBundle.moha);
  });

  it("drishti (pattern fixation) responds to a dominant repeated action", () => {
    const repetitive = ["fs.read", "fs.read", "fs.read", "fs.read", "fs.read", "fs.read"];
    const fn = createKleshaSignalFn(
      createDefaultKleshas(),
      () => assessmentOf(0.2),
      repetitive,
    );
    let bundle = fn();
    for (let n = 0; n < 5; n++) bundle = fn();
    expect(bundle.drishti).toBeGreaterThan(0);
  });

  it("respects sessionId pass-through without throwing", () => {
    const fn = createKleshaSignalFn(createDefaultKleshas(), () => assessmentOf(0), []);
    expect(() => fn("session-123")).not.toThrow();
  });

  it("bounds the internal vedana history (no unbounded growth)", () => {
    const fn = createKleshaSignalFn(createDefaultKleshas(), () => assessmentOf(0.5), [], 5);
    // 100 calls with cap 5 — would blow up perceive cost if unbounded; just
    // assert it stays functional and bounded-cost (smoke for the shift path).
    let bundle = fn();
    for (let n = 0; n < 99; n++) bundle = fn();
    expect(bundle.sneha).toBeGreaterThanOrEqual(0);
  });
});
