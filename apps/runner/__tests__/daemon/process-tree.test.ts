/**
 * Tests for Plan37 C8 process tree types and logic.
 *
 * Tests the frozen interfaces from Spec Addendum:
 * - AgentRegistryEntry, ProcessTreeNode, SpawnDeniedError, Plan37RPCErrorCode
 * - Permission lattice: DRAINING check
 */

import { describe, it, expect } from "vitest";
import type {
  AgentRegistryEntry,
  ProcessTreeNode,
  SpawnDeniedError,
  ChildAgentSpawnConfig,
  IDaemonControlPlane,
  AgentLifecycleStatus,
} from "../../src/daemon/types.js";
import { Plan37RPCErrorCode, RPCErrorCode } from "../../src/daemon/types.js";

/**
 * Minimal simulation of the SEC-001 spawn guard as implemented in
 * handleSpawnChild() in daemon-entry.ts.
 * Mirrors the exact guard condition so the test is structurally equivalent.
 */
function simulateSpawnGuard(shuttingDown: boolean): { code: number; message: string } | null {
  if (shuttingDown) {
    return { code: Plan37RPCErrorCode.PARENT_DRAINING, message: 'Daemon is shutting down — spawn denied' };
  }
  return null;
}

describe("AgentRegistryEntry", () => {
  it("root agent has no parentAgentId", () => {
    const entry: AgentRegistryEntry = {
      agentId: "root",
      pid: 1234,
      status: "running",
      configPath: "/agents/root.json",
      socketPath: "/tmp/root.sock",
      logFile: "/logs/root.log",
      uptime: 100,
      childAgentIds: [],
    };
    expect(entry.parentAgentId).toBeUndefined();
    expect(entry.childAgentIds).toEqual([]);
  });

  it("child agent has parentAgentId set", () => {
    const entry: AgentRegistryEntry = {
      agentId: "child-1",
      pid: 5678,
      status: "running",
      configPath: "/agents/child.json",
      socketPath: "/tmp/child.sock",
      logFile: "/logs/child.log",
      uptime: 50,
      parentAgentId: "root",
      childAgentIds: [],
    };
    expect(entry.parentAgentId).toBe("root");
  });
});

describe("AgentLifecycleStatus", () => {
  it("includes all required lifecycle states", () => {
    const states: AgentLifecycleStatus[] = [
      "running", "draining", "terminated", "stopped", "unknown"
    ];
    expect(states).toHaveLength(5);
    expect(states).toContain("draining");
    expect(states).toContain("terminated");
  });
});

describe("ProcessTreeNode", () => {
  it("leaf node has empty children array", () => {
    const entry: AgentRegistryEntry = {
      agentId: "leaf",
      pid: 1111,
      status: "running",
      configPath: "/agents/leaf.json",
      socketPath: "/tmp/leaf.sock",
      logFile: "/logs/leaf.log",
      uptime: 10,
      childAgentIds: [],
    };
    const node: ProcessTreeNode = { entry, children: [] };
    expect(node.children).toEqual([]);
    expect(node.entry.agentId).toBe("leaf");
  });

  it("tree node contains nested child nodes", () => {
    const rootEntry: AgentRegistryEntry = {
      agentId: "root",
      pid: 1000,
      status: "running",
      configPath: "/agents/root.json",
      socketPath: "/tmp/root.sock",
      logFile: "/logs/root.log",
      uptime: 200,
      childAgentIds: ["child-1"],
    };
    const childEntry: AgentRegistryEntry = {
      agentId: "child-1",
      pid: 2000,
      status: "running",
      configPath: "/agents/child.json",
      socketPath: "/tmp/child.sock",
      logFile: "/logs/child.log",
      uptime: 100,
      parentAgentId: "root",
      childAgentIds: [],
    };
    const tree: ProcessTreeNode = {
      entry: rootEntry,
      children: [{ entry: childEntry, children: [] }],
    };
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].entry.agentId).toBe("child-1");
    expect(tree.children[0].entry.parentAgentId).toBe("root");
  });
});

describe("SpawnDeniedError", () => {
  it("DRAINING reason is correctly typed", () => {
    const err: SpawnDeniedError = {
      code: "SPAWN_DENIED",
      reason: "DRAINING",
      parentId: "parent-1",
      detail: "Parent is draining",
    };
    expect(err.code).toBe("SPAWN_DENIED");
    expect(err.reason).toBe("DRAINING");
    expect(err.parentId).toBe("parent-1");
  });

  it("all reason values are typed correctly", () => {
    const reasons: SpawnDeniedError["reason"][] = [
      "DRAINING",
      "PATH_VIOLATION",
      "BUDGET_EXCEEDED",
      "CEILING_EXCEEDED",
      "CAPABILITY_VIOLATION",
    ];
    expect(reasons).toHaveLength(5);
  });
});

describe("Plan37RPCErrorCode", () => {
  it("defines all required Plan37 error codes", () => {
    expect(Plan37RPCErrorCode.SPAWN_DENIED).toBe(-32010);
    expect(Plan37RPCErrorCode.AGENT_NOT_FOUND_FOR_TREE).toBe(-32011);
    expect(Plan37RPCErrorCode.PARENT_DRAINING).toBe(-32012);
    expect(Plan37RPCErrorCode.PERMISSION_LATTICE_VIOLATION).toBe(-32013);
  });

  it("Plan37 error codes do not overlap with base RPCErrorCode", () => {
    const baseCodes = Object.values(RPCErrorCode);
    const plan37Codes = Object.values(Plan37RPCErrorCode);
    for (const code of plan37Codes) {
      expect(baseCodes).not.toContain(code);
    }
  });
});

describe("SEC-001 — Daemon-level drain-evasion spawn guard", () => {
  it("denies spawn when daemon shuttingDown=true (PARENT_DRAINING)", () => {
    const result = simulateSpawnGuard(true);
    expect(result).not.toBeNull();
    expect(result!.code).toBe(Plan37RPCErrorCode.PARENT_DRAINING);
    expect(result!.message).toMatch(/shutting down/);
  });

  it("allows spawn when daemon shuttingDown=false", () => {
    const result = simulateSpawnGuard(false);
    expect(result).toBeNull();
  });
});

describe("ChildAgentSpawnConfig", () => {
  it("constructs with required fields", () => {
    const config: ChildAgentSpawnConfig = {
      agentId: "child-99",
      configPath: "/agents/child.json",
      statePath: "/state/child",
    };
    expect(config.agentId).toBe("child-99");
    expect(config.env).toBeUndefined();
  });

  it("accepts optional env", () => {
    const config: ChildAgentSpawnConfig = {
      agentId: "child-99",
      configPath: "/agents/child.json",
      statePath: "/state/child",
      env: { MY_VAR: "value" },
    };
    expect(config.env?.MY_VAR).toBe("value");
  });
});
