import { describe, it, expect, beforeEach } from "vitest";
import { validateSpawnConstraints, computeAgentDepth } from "../../src/daemon/spawn-validator.js";
import { MessageRouter } from "../../src/daemon/message-router.js";
import { SpawnDeniedError, COMPOSITE_AGENT_MAX_DEPTH } from "@openstarry/sdk";
import type { AgentRegistryEntry } from "../../src/daemon/types.js";

const makeParent = (overrides?: Partial<AgentRegistryEntry>): AgentRegistryEntry => ({
  agentId: "parent",
  pid: 1000,
  status: 'running',
  configPath: "/agents/parent",
  socketPath: "/tmp/parent.sock",
  logFile: "/tmp/parent.log",
  uptime: 0,
  parentAgentId: undefined,
  childAgentIds: [],
  ...overrides,
});

describe("validateSpawnConstraints (Plan38 C11 — F-5)", () => {
  let router: MessageRouter;

  beforeEach(() => {
    router = new MessageRouter();
    router.registerAgent("parent", { canSendTo: ["*"], canReceiveFrom: ["*"], exposedTools: ["tool-a"] });
  });

  it("passes with valid constraints", () => {
    expect(() => validateSpawnConstraints({
      parentEntry: makeParent(),
      childConfig: { agentId: "child", configPath: "/agents/parent/child.json" },
      parentDepth: 0,
      messageRouter: router,
    })).not.toThrow();
  });

  it("rejects when depth exceeds max", () => {
    expect(() => validateSpawnConstraints({
      parentEntry: makeParent(),
      childConfig: { agentId: "child", configPath: "/agents/child.json" },
      parentDepth: COMPOSITE_AGENT_MAX_DEPTH,
      messageRouter: router,
    })).toThrow(SpawnDeniedError);
  });

  it("rejects when token budget exceeds parent remaining", () => {
    expect(() => validateSpawnConstraints({
      parentEntry: makeParent(),
      childConfig: { agentId: "child", configPath: "/agents/child.json", maxTokenBudget: 500 },
      parentDepth: 0,
      parentRemainingBudget: 100,
      messageRouter: router,
    })).toThrow(SpawnDeniedError);
  });

  it("rejects when confidence ceiling exceeds parent", () => {
    expect(() => validateSpawnConstraints({
      parentEntry: makeParent(),
      childConfig: { agentId: "child", configPath: "/agents/child.json", maxConfidenceCeiling: 0.9 },
      parentDepth: 0,
      parentCurrentConfidence: 0.5,
      messageRouter: router,
    })).toThrow(SpawnDeniedError);
  });

  it("rejects when child comm capabilities exceed parent", () => {
    router.registerAgent("parent", { canSendTo: ["b"], canReceiveFrom: ["b"], exposedTools: ["tool-a"] });
    expect(() => validateSpawnConstraints({
      parentEntry: makeParent(),
      childConfig: { agentId: "child", configPath: "/agents/child.json" },
      childAgentConfig: {
        identity: { id: "child", name: "child" },
        cognition: {},
        capabilities: { tools: [] },
        plugins: [{ name: "p" }],
        communication: { canSendTo: ["z"], canReceiveFrom: [], exposedTools: [] },
      } as any,
      parentDepth: 0,
      messageRouter: router,
    })).toThrow(SpawnDeniedError);
  });

  it("passes when child has zero capabilities (Rule #37)", () => {
    expect(() => validateSpawnConstraints({
      parentEntry: makeParent(),
      childConfig: { agentId: "child", configPath: "/agents/child.json" },
      childAgentConfig: {
        identity: { id: "child", name: "child" },
        cognition: {},
        capabilities: { tools: [] },
        plugins: [{ name: "p" }],
        communication: { canSendTo: [], canReceiveFrom: [], exposedTools: [] },
      } as any,
      parentDepth: 0,
      messageRouter: router,
    })).not.toThrow();
  });
});

describe("computeAgentDepth", () => {
  it("returns 0 for root agent", () => {
    const registry = new Map<string, AgentRegistryEntry>();
    registry.set("root", makeParent({ agentId: "root" }));
    expect(computeAgentDepth("root", registry)).toBe(0);
  });

  it("returns correct depth for nested agent", () => {
    const registry = new Map<string, AgentRegistryEntry>();
    registry.set("root", makeParent({ agentId: "root" }));
    registry.set("child", makeParent({ agentId: "child", parentAgentId: "root" }));
    registry.set("grandchild", makeParent({ agentId: "grandchild", parentAgentId: "child" }));
    expect(computeAgentDepth("grandchild", registry)).toBe(2);
  });
});
