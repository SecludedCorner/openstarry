import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentRegistry } from "../src/registry.js";
import { handleAgentCrash } from "../src/crash-handler.js";

describe("Crash Handler (Plan38 C8)", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
    registry.register({
      agentId: "agent-1",
      channelId: "test-ch",
      pid: 1234,
      health: 'HEALTHY',
      mcpEndpoint: "",
      capabilities: ["canSendTo", "canReceiveFrom"],
      exposedTools: ["t"],
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
      consecutiveMisses: 0,
      routingCapabilities: { canSendTo: ["*"], canReceiveFrom: ["*"], exposedTools: ["t"] },
    });
  });

  afterEach(() => {
    registry.stopHeartbeatMonitor();
  });

  it("executes 7-step crash handling and removes agent", async () => {
    const event = await handleAgentCrash(registry, "agent-1", "heartbeat timeout");
    expect(event.agentId).toBe("agent-1");
    expect(event.reason).toBe("heartbeat timeout");
    expect(event.timestamp).toBeGreaterThan(0);
    expect(registry.has("agent-1")).toBe(false);
  });

  it("handles already-removed agent gracefully", async () => {
    registry.deregister("agent-1");
    const event = await handleAgentCrash(registry, "agent-1", "duplicate crash");
    expect(event.agentId).toBe("agent-1");
    // Should not throw
  });

  it("returns CrashEvent with timestamp", async () => {
    const before = Date.now();
    const event = await handleAgentCrash(registry, "agent-1", "test");
    expect(event.timestamp).toBeGreaterThanOrEqual(before);
  });
});
