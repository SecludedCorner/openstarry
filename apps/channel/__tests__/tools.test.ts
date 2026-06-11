import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentRegistry } from "../src/registry.js";
import type { AgentCapabilities } from "../src/registry.js";
import { registerAgent } from "../src/tools/register.js";
import { deregisterAgent } from "../src/tools/deregister.js";
import { sendMessage } from "../src/tools/send.js";
import { broadcastMessage } from "../src/tools/broadcast.js";
import { listAgents } from "../src/tools/list-agents.js";
import { getAgentStatus } from "../src/tools/get-status.js";
import { MAX_TRACE_DEPTH } from "@openstarry/sdk";
import type { CommMessage, BroadcastResult } from "@openstarry/sdk";

const makeCaps = (overrides?: Partial<AgentCapabilities>): AgentCapabilities => ({
  canSendTo: ["*"],
  canReceiveFrom: ["*"],
  exposedTools: ["tool-a"],
  ...overrides,
});

function makeMsg(source: string, target?: string, overrides?: Partial<CommMessage>): CommMessage {
  return {
    id: `msg-${Date.now()}`,
    source,
    target,
    performative: "inform",
    payload: { text: "hello" },
    timestamp: Date.now(),
    ...overrides,
  };
}

/** Build a pidToAgentMap from pid->agentId pairs. */
function makePidMap(entries: Array<[number, string]>): Map<number, string> {
  return new Map(entries);
}

describe("Channel Tools (Plan38 C6)", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  afterEach(() => {
    registry.stopHeartbeatMonitor();
  });

  describe("register_agent (C6a)", () => {
    it("registers with valid params and matching PID", async () => {
      const pidMap = makePidMap([[1234, "agent-1"]]);
      const result = await registerAgent(registry, {
        agentId: "agent-1", pid: 1234, capabilities: makeCaps(), exposedTools: ["tool-a"],
      }, "ch-1", 10000, pidMap);
      expect(result.channelId).toBe("ch-1");
      expect(result.registeredAgents).toContain("agent-1");
      expect(registry.has("agent-1")).toBe(true);
    });

    it("rejects duplicate agentId", async () => {
      const pidMap = makePidMap([[1234, "agent-1"], [5678, "agent-1"]]);
      await registerAgent(registry, {
        agentId: "agent-1", pid: 1234, capabilities: makeCaps(), exposedTools: ["tool-a"],
      }, "ch-1", 10000, pidMap);
      await expect(registerAgent(registry, {
        agentId: "agent-1", pid: 5678, capabilities: makeCaps(), exposedTools: ["tool-b"],
      }, "ch-1", 10000, pidMap)).rejects.toThrow(/already registered/);
    });

    it("rejects zero exposedTools", async () => {
      const pidMap = makePidMap([[1234, "agent-1"]]);
      await expect(registerAgent(registry, {
        agentId: "agent-1", pid: 1234, capabilities: makeCaps(), exposedTools: [],
      }, "ch-1", 10000, pidMap)).rejects.toThrow(/exposedTool/);
    });

    it("SEC-002: rejects PID-agentId mismatch", async () => {
      const pidMap = makePidMap([[1234, "agent-other"]]);
      await expect(registerAgent(registry, {
        agentId: "agent-1", pid: 1234, capabilities: makeCaps(), exposedTools: ["tool-a"],
      }, "ch-1", 10000, pidMap)).rejects.toThrow(/SEC-002/);
    });

    it("SEC-002: rejects unknown PID (fail-closed)", async () => {
      const pidMap = makePidMap([[9999, "some-other-agent"]]);
      await expect(registerAgent(registry, {
        agentId: "agent-1", pid: 1234, capabilities: makeCaps(), exposedTools: ["tool-a"],
      }, "ch-1", 10000, pidMap)).rejects.toThrow(/SEC-002/);
    });
  });

  describe("deregister_agent (C6b)", () => {
    it("self-deregister succeeds", async () => {
      const pidMap = makePidMap([[1234, "agent-1"]]);
      await registerAgent(registry, {
        agentId: "agent-1", pid: 1234, capabilities: makeCaps(), exposedTools: ["t"],
      }, "ch-1", 10000, pidMap);
      const result = await deregisterAgent(registry, { agentId: "agent-1", callerId: "agent-1" });
      expect(result.success).toBe(true);
      expect(registry.has("agent-1")).toBe(false);
    });

    it("rejects cross-deregister", async () => {
      const result = await deregisterAgent(registry, { agentId: "agent-1", callerId: "agent-2" });
      expect(result.success).toBe(false);
      expect(result.reason).toMatch(/self-only/);
    });

    it("returns failure for non-registered agent", async () => {
      const result = await deregisterAgent(registry, { agentId: "ghost", callerId: "ghost" });
      expect(result.success).toBe(false);
      expect(result.reason).toMatch(/not registered/);
    });

    it("notifies survivors after deregistration (audit log path)", async () => {
      const pidMap = makePidMap([[1, "agent-1"], [2, "agent-2"]]);
      await registerAgent(registry, {
        agentId: "agent-1", pid: 1, capabilities: makeCaps(), exposedTools: ["t"],
      }, "ch", 10000, pidMap);
      await registerAgent(registry, {
        agentId: "agent-2", pid: 2, capabilities: makeCaps(), exposedTools: ["t"],
      }, "ch", 10000, pidMap);
      // Deregister agent-1; agent-2 should remain (survivor notification stub executes)
      const result = await deregisterAgent(registry, { agentId: "agent-1", callerId: "agent-1" });
      expect(result.success).toBe(true);
      expect(registry.has("agent-1")).toBe(false);
      expect(registry.has("agent-2")).toBe(true);
    });
  });

  describe("send_message (C6c) — 7-step validation", () => {
    beforeEach(async () => {
      // Register two agents: a can send to b only, b can receive from a only
      const pidMap = makePidMap([[100, "a"], [200, "b"]]);
      await registerAgent(registry, {
        agentId: "a", pid: 100,
        capabilities: makeCaps({ canSendTo: ["b"], canReceiveFrom: ["b"] }),
        exposedTools: ["t"],
      }, "ch", 10000, pidMap);
      await registerAgent(registry, {
        agentId: "b", pid: 200,
        capabilities: makeCaps({ canSendTo: [], canReceiveFrom: ["a"] }),
        exposedTools: ["t"],
      }, "ch", 10000, pidMap);
    });

    it("delivers valid message", async () => {
      const result = await sendMessage(registry, "a", makeMsg("a", "b"));
      expect(result.delivered).toBe(true);
    });

    it("L1: rejects unregistered sender", async () => {
      const result = await sendMessage(registry, "ghost", makeMsg("ghost", "b"));
      expect(result.delivered).toBe(false);
      expect(result.errorCode).toBe(-33001);
    });

    it("L3: rejects sender without canSendTo", async () => {
      const result = await sendMessage(registry, "b", makeMsg("b", "a"));
      expect(result.delivered).toBe(false);
      expect(result.errorCode).toBe(-33004);
    });

    it("L5: rejects negative traceDepth", async () => {
      const result = await sendMessage(registry, "a", makeMsg("a", "b", { traceDepth: -1 }));
      expect(result.delivered).toBe(false);
      expect(result.errorCode).toBe(-33006);
    });

    it("L5: rejects traceDepth > MAX", async () => {
      const result = await sendMessage(registry, "a", makeMsg("a", "b", { traceDepth: MAX_TRACE_DEPTH + 1 }));
      expect(result.delivered).toBe(false);
      expect(result.errorCode).toBe(-33007);
    });
  });

  describe("broadcast (C6d)", () => {
    it("returns BroadcastResult[] per-target array (SDK type conformance)", async () => {
      const pidMap = makePidMap([[1, "sender"], [2, "b"]]);
      await registerAgent(registry, {
        agentId: "sender", pid: 1, capabilities: makeCaps({ canSendTo: ["b"] }), exposedTools: ["t"],
      }, "ch", 10000, pidMap);
      await registerAgent(registry, {
        agentId: "b", pid: 2, capabilities: makeCaps({ canReceiveFrom: ["sender"] }), exposedTools: ["t"],
      }, "ch", 10000, pidMap);

      const results = await broadcastMessage(registry, "sender", makeMsg("sender"));
      expect(Array.isArray(results)).toBe(true);
      // Each element must have agentId and success fields (SDK BroadcastResult shape)
      for (const r of results) {
        expect(r).toHaveProperty("agentId");
        expect(r).toHaveProperty("success");
      }
    });

    it("per-target capability check with partial success", async () => {
      const pidMap = makePidMap([[1, "sender"], [2, "b"], [3, "c"]]);
      await registerAgent(registry, {
        agentId: "sender", pid: 1, capabilities: makeCaps({ canSendTo: ["b"] }), exposedTools: ["t"],
      }, "ch", 10000, pidMap);
      await registerAgent(registry, {
        agentId: "b", pid: 2, capabilities: makeCaps({ canReceiveFrom: ["sender"] }), exposedTools: ["t"],
      }, "ch", 10000, pidMap);
      await registerAgent(registry, {
        agentId: "c", pid: 3, capabilities: makeCaps({ canReceiveFrom: ["sender"] }), exposedTools: ["t"],
      }, "ch", 10000, pidMap);

      const results = await broadcastMessage(registry, "sender", makeMsg("sender"));
      const successCount = results.filter((r: BroadcastResult) => r.success).length;
      const failCount = results.filter((r: BroadcastResult) => !r.success).length;
      expect(successCount).toBe(1); // b only (sender can only sendTo b)
      expect(failCount).toBe(1);    // c denied
    });

    it("returns failure entry for unknown sender", async () => {
      const results = await broadcastMessage(registry, "ghost", makeMsg("ghost"));
      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe("ghost");
      expect(results[0].success).toBe(false);
    });
  });

  describe("list_agents (C6e)", () => {
    it("returns all agents (fail-open)", async () => {
      const pidMap = makePidMap([[1, "a"]]);
      await registerAgent(registry, {
        agentId: "a", pid: 1, capabilities: makeCaps(), exposedTools: ["t"],
      }, "ch", 10000, pidMap);
      const list = await listAgents(registry);
      expect(list).toHaveLength(1);
      expect(list[0].agentId).toBe("a");
      expect(list[0].health).toBe("HEALTHY");
    });
  });

  describe("get_agent_status (C6f)", () => {
    it("returns status for capability-reachable agent", async () => {
      const pidMap = makePidMap([[1, "caller"], [2, "target"]]);
      await registerAgent(registry, {
        agentId: "caller", pid: 1, capabilities: makeCaps({ canSendTo: ["target"] }), exposedTools: ["t"],
      }, "ch", 10000, pidMap);
      await registerAgent(registry, {
        agentId: "target", pid: 2, capabilities: makeCaps(), exposedTools: ["tool-x"],
      }, "ch", 10000, pidMap);

      const result = await getAgentStatus(registry, "caller", "target");
      expect('agentId' in result && result.agentId).toBe("target");
    });

    it("denies status for non-reachable agent", async () => {
      const pidMap = makePidMap([[1, "caller"], [2, "target"]]);
      await registerAgent(registry, {
        agentId: "caller", pid: 1, capabilities: makeCaps({ canSendTo: [] }), exposedTools: ["t"],
      }, "ch", 10000, pidMap);
      await registerAgent(registry, {
        agentId: "target", pid: 2, capabilities: makeCaps(), exposedTools: ["t"],
      }, "ch", 10000, pidMap);

      const result = await getAgentStatus(registry, "caller", "target");
      expect('error' in result).toBe(true);
    });
  });
});
