/**
 * Tests for CommConfigSchema — Plan37 W2 communication config Zod validation.
 */

import { describe, it, expect } from "vitest";
import { CommConfigSchema, AgentConfigSchema } from "../config-schema.js";

describe("CommConfigSchema", () => {
  it("accepts empty object (all fields optional)", () => {
    const result = CommConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts valid communication config", () => {
    const result = CommConfigSchema.safeParse({
      canSendTo: ["orchestrator"],
      canReceiveFrom: ["orchestrator"],
      exposedTools: ["read_file"],
      maxMessageSize: 4096,
      eventSubscriptions: ["agent:started"],
      timeoutMs: 30000,
      maxRetries: 3,
      gracePeriodMs: 30000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects gracePeriodMs above 300000 (MECHANISM ceiling)", () => {
    const result = CommConfigSchema.safeParse({
      gracePeriodMs: 300001,
    });
    expect(result.success).toBe(false);
  });

  it("accepts gracePeriodMs at exactly 300000", () => {
    const result = CommConfigSchema.safeParse({
      gracePeriodMs: 300000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts gracePeriodMs = 0", () => {
    const result = CommConfigSchema.safeParse({
      gracePeriodMs: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative gracePeriodMs", () => {
    const result = CommConfigSchema.safeParse({
      gracePeriodMs: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer gracePeriodMs", () => {
    const result = CommConfigSchema.safeParse({
      gracePeriodMs: 30000.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative maxRetries", () => {
    const result = CommConfigSchema.safeParse({
      maxRetries: -1,
    });
    expect(result.success).toBe(false);
  });

  it("accepts maxRetries = 0", () => {
    const result = CommConfigSchema.safeParse({
      maxRetries: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects maxMessageSize = 0 (must be positive)", () => {
    const result = CommConfigSchema.safeParse({
      maxMessageSize: 0,
    });
    expect(result.success).toBe(false);
  });

  it("canSendTo accepts array of strings", () => {
    const result = CommConfigSchema.safeParse({
      canSendTo: ["agent-a", "agent-b"],
    });
    expect(result.success).toBe(true);
  });
});

describe("AgentConfigSchema with communication field", () => {
  const minimalBase = {
    identity: { id: "test", name: "Test Agent" },
    cognition: {},
    capabilities: { tools: [] },
    plugins: [{ name: "test-plugin" }],
  };

  it("accepts config without communication section (backward compat)", () => {
    const result = AgentConfigSchema.safeParse(minimalBase);
    expect(result.success).toBe(true);
  });

  it("accepts config with valid communication section", () => {
    const result = AgentConfigSchema.safeParse({
      ...minimalBase,
      communication: {
        canSendTo: ["orchestrator"],
        gracePeriodMs: 60000,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects communication.gracePeriodMs > 300000 in full config", () => {
    const result = AgentConfigSchema.safeParse({
      ...minimalBase,
      communication: {
        gracePeriodMs: 999999,
      },
    });
    expect(result.success).toBe(false);
  });
});
