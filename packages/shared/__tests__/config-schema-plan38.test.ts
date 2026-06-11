import { describe, it, expect } from "vitest";
import { AgentConfigSchema } from "../src/utils/config-schema.js";

describe("AgentConfigSchema Plan38 C15 (BUG-2 compliance)", () => {
  it("validates typed safety config", () => {
    const config = {
      identity: { id: "test", name: "test" },
      cognition: {},
      capabilities: { tools: [] },
      plugins: [{ name: "test-plugin" }],
      safety: { maxLoopTicks: 50, maxTokenUsage: 100000 },
    };
    const result = AgentConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("rejects invalid safety field type", () => {
    const config = {
      identity: { id: "test", name: "test" },
      cognition: {},
      capabilities: { tools: [] },
      plugins: [{ name: "test-plugin" }],
      safety: { maxLoopTicks: "not-a-number" },
    };
    const result = AgentConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it("validates typed session config", () => {
    const config = {
      identity: { id: "test", name: "test" },
      cognition: {},
      capabilities: { tools: [] },
      plugins: [{ name: "test-plugin" }],
      session: { persistence: { enabled: true }, replayCount: 5 },
    };
    const result = AgentConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("validates communication config (Plan37 existing)", () => {
    const config = {
      identity: { id: "test", name: "test" },
      cognition: {},
      capabilities: { tools: [] },
      plugins: [{ name: "test-plugin" }],
      communication: { canSendTo: ["*"], canReceiveFrom: ["*"], gracePeriodMs: 30000 },
    };
    const result = AgentConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });
});
