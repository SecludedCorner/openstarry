import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentRegistry, RWLock } from "../src/registry.js";
import type { ChannelAgentEntry, AgentCapabilities } from "../src/registry.js";

const makeCaps = (overrides?: Partial<AgentCapabilities>): AgentCapabilities => ({
  canSendTo: ["*"],
  canReceiveFrom: ["*"],
  exposedTools: ["tool-a"],
  ...overrides,
});

const makeEntry = (id: string, overrides?: Partial<ChannelAgentEntry>): ChannelAgentEntry => ({
  agentId: id,
  channelId: "test-ch",
  pid: 1000 + Math.floor(Math.random() * 9000),
  health: 'HEALTHY',
  mcpEndpoint: "",
  capabilities: ["canSendTo", "canReceiveFrom", "exposedTools"],
  exposedTools: ["tool-a"],
  registeredAt: Date.now(),
  lastHeartbeat: Date.now(),
  consecutiveMisses: 0,
  routingCapabilities: makeCaps(),
  ...overrides,
});

describe("AgentRegistry (Plan38 C5)", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  afterEach(() => {
    registry.stopHeartbeatMonitor();
  });

  it("registers and retrieves an agent", () => {
    const entry = makeEntry("agent-1");
    registry.register(entry);
    expect(registry.has("agent-1")).toBe(true);
    expect(registry.get("agent-1")).toBe(entry);
    expect(registry.size).toBe(1);
  });

  it("deregisters an agent and returns the entry", () => {
    const entry = makeEntry("agent-1");
    registry.register(entry);
    const removed = registry.deregister("agent-1");
    expect(removed).toBe(entry);
    expect(registry.has("agent-1")).toBe(false);
    expect(registry.size).toBe(0);
  });

  it("returns undefined when deregistering non-existent agent", () => {
    expect(registry.deregister("ghost")).toBeUndefined();
  });

  it("lists all registered agents", () => {
    registry.register(makeEntry("a"));
    registry.register(makeEntry("b"));
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map(a => a.agentId).sort()).toEqual(["a", "b"]);
  });

  it("records heartbeat and resets health to HEALTHY", () => {
    const entry = makeEntry("agent-1", { health: 'DEGRADED', consecutiveMisses: 2 });
    registry.register(entry);
    registry.recordHeartbeat("agent-1");
    const updated = registry.get("agent-1")!;
    expect(updated.health).toBe('HEALTHY');
    expect(updated.consecutiveMisses).toBe(0);
  });

  it("4-state health transitions via setHealth", () => {
    registry.register(makeEntry("agent-1"));
    registry.setHealth("agent-1", 'DEGRADED');
    expect(registry.get("agent-1")!.health).toBe('DEGRADED');
    registry.setHealth("agent-1", 'UNREACHABLE');
    expect(registry.get("agent-1")!.health).toBe('UNREACHABLE');
    registry.setHealth("agent-1", 'TERMINATED');
    expect(registry.get("agent-1")!.health).toBe('TERMINATED');
  });
});

describe("RWLock", () => {
  it("allows concurrent reads", async () => {
    const lock = new RWLock();
    await lock.acquireRead();
    await lock.acquireRead();
    lock.releaseRead();
    lock.releaseRead();
  });

  it("write is exclusive", async () => {
    const lock = new RWLock();
    await lock.acquireWrite();
    let writeAcquired = false;
    const p = lock.acquireWrite().then(() => { writeAcquired = true; });
    // Second write should be queued
    await new Promise(r => setTimeout(r, 10));
    expect(writeAcquired).toBe(false);
    lock.releaseWrite();
    await p;
    expect(writeAcquired).toBe(true);
    lock.releaseWrite();
  });
});
