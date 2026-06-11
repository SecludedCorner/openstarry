/**
 * Tests for clampAuditDelta.
 * @see mano/confidence-audit.ts
 */
import { describe, it, expect } from "vitest";
import { clampAuditDelta } from "../confidence-audit.js";
import { DEFAULT_CONFIDENCE_AUDIT_CONFIG } from "@openstarry/sdk";

const MAX_DELTA = DEFAULT_CONFIDENCE_AUDIT_CONFIG.maxAuditDelta; // 0.05

describe("clampAuditDelta", () => {
  it("returns 0 for 0", () => {
    expect(clampAuditDelta(0, MAX_DELTA)).toBe(0);
  });

  it("passes through values within bounds", () => {
    expect(clampAuditDelta(0.03, MAX_DELTA)).toBe(0.03);
    expect(clampAuditDelta(-0.02, MAX_DELTA)).toBe(-0.02);
  });

  it("clamps positive values above maxDelta", () => {
    expect(clampAuditDelta(0.10, MAX_DELTA)).toBe(MAX_DELTA);
    expect(clampAuditDelta(1.0, MAX_DELTA)).toBe(MAX_DELTA);
  });

  it("clamps negative values below -maxDelta", () => {
    expect(clampAuditDelta(-0.10, MAX_DELTA)).toBe(-MAX_DELTA);
    expect(clampAuditDelta(-1.0, MAX_DELTA)).toBe(-MAX_DELTA);
  });

  it("boundary: exactly ±maxDelta passes through", () => {
    expect(clampAuditDelta(MAX_DELTA, MAX_DELTA)).toBe(MAX_DELTA);
    expect(clampAuditDelta(-MAX_DELTA, MAX_DELTA)).toBe(-MAX_DELTA);
  });

  it("returns 0 for NaN (SEC-029-01 guard)", () => {
    expect(clampAuditDelta(NaN, MAX_DELTA)).toBe(0);
  });

  it("returns 0 for Infinity (SEC-029-01 guard)", () => {
    expect(clampAuditDelta(Infinity, MAX_DELTA)).toBe(0);
    expect(clampAuditDelta(-Infinity, MAX_DELTA)).toBe(0);
  });

  it("respects custom maxDelta", () => {
    expect(clampAuditDelta(0.20, 0.10)).toBe(0.10);
    expect(clampAuditDelta(-0.20, 0.10)).toBe(-0.10);
    expect(clampAuditDelta(0.05, 0.10)).toBe(0.05);
  });
});
