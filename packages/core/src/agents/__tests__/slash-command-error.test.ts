import { describe, it, expect, vi } from "vitest";
import type { IAgentConfig, AgentEvent } from "@openstarry/sdk";
import { AgentEventType } from "@openstarry/sdk";
import { createAgentCore } from "../agent-core.js";

describe("Slash command error emission (B3)", () => {
  const createMockConfig = (): IAgentConfig => ({
    identity: { id: "test-agent", name: "Test Agent" },
    plugins: [],
    cognition: {
      provider: "test-provider",
      model: "test-model",
    },
    capabilities: {},
  });

  it("emits LOOP_ERROR and MESSAGE_SYSTEM when a slash command throws", async () => {
    const core = createAgentCore(createMockConfig());

    // Register a command that throws
    core.commandRegistry.register({
      name: "boom",
      description: "A command that always throws",
      execute: async () => {
        throw new Error("kaboom!");
      },
    });

    const events: AgentEvent[] = [];
    core.bus.on(AgentEventType.LOOP_ERROR, (e) => events.push(e));
    core.bus.on(AgentEventType.MESSAGE_SYSTEM, (e) => events.push(e));

    core.pushInput({
      source: "test",
      inputType: "user_input",
      data: "/boom",
      sessionId: undefined,
    });

    // The slash command handler is async (promise-based), wait for it
    await vi.waitFor(() => {
      expect(events.length).toBeGreaterThanOrEqual(2);
    });

    const loopError = events.find((e) => e.type === AgentEventType.LOOP_ERROR);
    expect(loopError).toBeDefined();
    expect(loopError!.payload).toMatchObject({
      error: expect.stringContaining("kaboom!"),
    });

    const sysMsg = events.find((e) => e.type === AgentEventType.MESSAGE_SYSTEM);
    expect(sysMsg).toBeDefined();
    expect(sysMsg!.payload).toMatchObject({
      text: "Error: kaboom!",
    });
  });

  it("includes sessionId in error events", async () => {
    const core = createAgentCore(createMockConfig());

    core.commandRegistry.register({
      name: "fail",
      description: "Failing command",
      execute: async () => {
        throw new Error("session fail");
      },
    });

    const events: AgentEvent[] = [];
    core.bus.on(AgentEventType.LOOP_ERROR, (e) => events.push(e));
    core.bus.on(AgentEventType.MESSAGE_SYSTEM, (e) => events.push(e));

    const testSessionId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    core.pushInput({
      source: "test",
      inputType: "user_input",
      data: "/fail arg1",
      sessionId: testSessionId,
    });

    await vi.waitFor(() => {
      expect(events.length).toBeGreaterThanOrEqual(2);
    });

    const loopError = events.find((e) => e.type === AgentEventType.LOOP_ERROR);
    expect(loopError!.payload.sessionId).toBe(testSessionId);

    const sysMsg = events.find((e) => e.type === AgentEventType.MESSAGE_SYSTEM);
    expect(sysMsg!.payload.sessionId).toBe(testSessionId);
  });

  it("handles non-Error thrown values", async () => {
    const core = createAgentCore(createMockConfig());

    core.commandRegistry.register({
      name: "throwstring",
      description: "Throws a string",
      execute: async () => {
        throw "raw string error";
      },
    });

    const events: AgentEvent[] = [];
    core.bus.on(AgentEventType.LOOP_ERROR, (e) => events.push(e));
    core.bus.on(AgentEventType.MESSAGE_SYSTEM, (e) => events.push(e));

    core.pushInput({
      source: "test",
      inputType: "user_input",
      data: "/throwstring",
    });

    await vi.waitFor(() => {
      expect(events.length).toBeGreaterThanOrEqual(2);
    });

    const loopError = events.find((e) => e.type === AgentEventType.LOOP_ERROR);
    expect(loopError!.payload.error).toContain("raw string error");

    const sysMsg = events.find((e) => e.type === AgentEventType.MESSAGE_SYSTEM);
    expect(sysMsg!.payload.text).toBe("Error: raw string error");
  });
});
