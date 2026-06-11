import { describe, it, expect } from "vitest";
import {
  L2_THRESHOLD,
  L3_THRESHOLD,
  MIN_N_FOR_RECAL,
  WIENER_THRESHOLD_HIT_EVENT,
  type WienerThresholdHit,
} from "../../src/wiener/thresholds.js";

describe("wiener/thresholds (Plan49 C49-M5a)", () => {
  it("exports HYPOTHESIS-status L2 + L3 constants", () => {
    expect(typeof L2_THRESHOLD).toBe("number");
    expect(typeof L3_THRESHOLD).toBe("number");
    // C49-M5e: values are frozen in Plan49 (no value tuning). We assert shape + range only,
    // not specific values, so that a later re-calibration (Plan51+) doesn't break this test.
    expect(L2_THRESHOLD).toBeGreaterThan(0);
    expect(L2_THRESHOLD).toBeLessThanOrEqual(1);
    expect(L3_THRESHOLD).toBeGreaterThan(L2_THRESHOLD);
    expect(L3_THRESHOLD).toBeLessThanOrEqual(1);
  });

  it("exposes Rule #72 N-gate constant", () => {
    expect(MIN_N_FOR_RECAL).toBe(10);
  });

  it("exposes telemetry event name for Plan48 structured-log integration", () => {
    expect(WIENER_THRESHOLD_HIT_EVENT).toBe("wiener_threshold_hit");
  });

  it("WienerThresholdHit type accepts both L2 and L3 tags", () => {
    const hitL2: WienerThresholdHit = {
      threshold: "L2",
      value: L2_THRESHOLD,
      observed: 0.9,
      nAtHit: 4,
      timestamp: Date.now(),
    };
    const hitL3: WienerThresholdHit = {
      threshold: "L3",
      value: L3_THRESHOLD,
      observed: 0.99,
      nAtHit: 4,
      timestamp: Date.now(),
    };
    expect(hitL2.threshold).toBe("L2");
    expect(hitL3.threshold).toBe("L3");
  });
});
