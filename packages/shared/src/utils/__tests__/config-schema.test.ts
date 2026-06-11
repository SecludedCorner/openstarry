/**
 * Tests for AgentConfigSchema — BUG-2 fix verification.
 * Verifies Plan32+ fields survive Zod validation via .passthrough().
 * @see Plan36a §6.2, D2-R1, PROC-SPEC-3
 */
import { describe, it, expect } from "vitest";
import { AgentConfigSchema } from "../config-schema.js";

function makeMinimalConfig(overrides: Record<string, unknown> = {}) {
  return {
    identity: { id: 'test', name: 'Test Agent' },
    cognition: { provider: 'mock', model: 'test-model' },
    capabilities: { tools: ['fs.read'] },
    plugins: [{ name: 'test-plugin' }],
    ...overrides,
  };
}

describe("AgentConfigSchema — BUG-2 Plan32+ fields", () => {
  it("should preserve safety field via .passthrough()", () => {
    const input = makeMinimalConfig({ safety: { maxLoopTicks: 50 } });
    const result = AgentConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.safety).toEqual({ maxLoopTicks: 50 });
    }
  });

  it("should preserve all 10 Plan32+ fields", () => {
    const input = makeMinimalConfig({
      safety: { maxLoopTicks: 50 },
      auditTrail: { filePath: './custom-audit.jsonl' },
      mano: { threshold: 0.7 },
      confidenceAudit: { enabled: true },
      vitakka: { maxIterations: 3 },
      vedanaEmergency: { sustainedTicks: 10 },
      execution: { timeout: 30000 },
      kleshaFilter: { enabled: false },
      maxTokenBudget: 100000,
      confidenceFloor: 0.5,
    });
    const result = AgentConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.safety).toEqual({ maxLoopTicks: 50 });
      expect(result.data.auditTrail).toEqual({ filePath: './custom-audit.jsonl' });
      expect(result.data.mano).toEqual({ threshold: 0.7 });
      expect(result.data.confidenceAudit).toEqual({ enabled: true });
      expect(result.data.vitakka).toEqual({ maxIterations: 3 });
      expect(result.data.vedanaEmergency).toEqual({ sustainedTicks: 10 });
      expect(result.data.execution).toEqual({ timeout: 30000 });
      expect(result.data.kleshaFilter).toEqual({ enabled: false });
      expect(result.data.maxTokenBudget).toBe(100000);
      expect(result.data.confidenceFloor).toBe(0.5);
    }
  });

  it("should preserve truly unknown fields via .passthrough()", () => {
    const input = makeMinimalConfig({ futureField: { custom: true } });
    const result = AgentConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).futureField).toEqual({ custom: true });
    }
  });

  it("should preserve session and sandbox fields", () => {
    const input = makeMinimalConfig({
      session: { timeout: 60000 },
      sandbox: { enabled: true },
    });
    const result = AgentConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.session).toEqual({ timeout: 60000 });
      expect(result.data.sandbox).toEqual({ enabled: true });
    }
  });

  it("should still validate required fields", () => {
    const result = AgentConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should validate maxTokenBudget as number", () => {
    const input = makeMinimalConfig({ maxTokenBudget: "not-a-number" });
    const result = AgentConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
