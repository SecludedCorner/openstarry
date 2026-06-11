/**
 * TypeScript compile-time validation for ConfidenceAuditLog.
 * @see types/confidence-audit-log.ts
 */
import { describe, it, expect } from "vitest";
import type { ConfidenceAuditLog } from "../confidence-audit-log.js";
import { MAX_AUDIT_REASONING_LENGTH } from "../confidence-audit-log.js";

describe("ConfidenceAuditLog type", () => {
  it("all required fields present and correctly typed", () => {
    // This object must compile — it validates that all required fields exist
    const log: ConfidenceAuditLog = {
      inputConfidence: 0.8,
      rawDelta: 0.1,
      clampedDelta: 0.05,
      wasClamped: true,
      reasoning: "test reasoning",
      outputConfidence: 0.85,
      result: "adjusted",
      auditDurationMs: 12,
    };

    expect(log.inputConfidence).toBe(0.8);
    expect(log.rawDelta).toBe(0.1);
    expect(log.clampedDelta).toBe(0.05);
    expect(log.wasClamped).toBe(true);
    expect(log.reasoning).toBe("test reasoning");
    expect(log.outputConfidence).toBe(0.85);
    expect(log.result).toBe("adjusted");
    expect(log.auditDurationMs).toBe(12);
  });

  it("result field accepts 'unchanged' variant", () => {
    const log: ConfidenceAuditLog = {
      inputConfidence: 0.7,
      rawDelta: 0,
      clampedDelta: 0,
      wasClamped: false,
      reasoning: "no change",
      outputConfidence: 0.7,
      result: "unchanged",
      auditDurationMs: 5,
    };
    expect(log.result).toBe("unchanged");
  });

  it("result field accepts 'error' variant", () => {
    const log: ConfidenceAuditLog = {
      inputConfidence: 0.6,
      rawDelta: 0,
      clampedDelta: 0,
      wasClamped: false,
      reasoning: "audit failed",
      outputConfidence: 0.6,
      result: "error",
      auditDurationMs: 200,
    };
    expect(log.result).toBe("error");
  });

  it("MAX_AUDIT_REASONING_LENGTH is 500", () => {
    expect(MAX_AUDIT_REASONING_LENGTH).toBe(500);
  });

  it("wasClamped is false when delta fits within bounds", () => {
    const log: ConfidenceAuditLog = {
      inputConfidence: 0.5,
      rawDelta: 0.03,
      clampedDelta: 0.03,
      wasClamped: false,
      reasoning: "small delta — no clamping",
      outputConfidence: 0.53,
      result: "adjusted",
      auditDurationMs: 8,
    };
    expect(log.wasClamped).toBe(false);
    expect(log.rawDelta).toBe(log.clampedDelta);
  });
});
