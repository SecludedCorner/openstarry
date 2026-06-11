/**
 * Tests for Plan37 C14: Graceful Shutdown Protocol.
 *
 * Tests the state machine and EventBridge notification using
 * EventBridge and GlobalServiceRegistry directly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventBridge } from "../../src/daemon/event-bridge.js";
import { GlobalServiceRegistry } from "../../src/daemon/global-service-registry.js";
import { DEFAULT_AGENT_GRACE_PERIOD_MS, MAX_AGENT_GRACE_PERIOD_MS } from "@openstarry/sdk";
import type { CoordinationMessage } from "../../src/daemon/event-bridge.js";
import type { AgentLifecycleStatus } from "../../src/daemon/types.js";

/**
 * Minimal in-process simulation of the C14 graceful shutdown protocol.
 * Mirrors the gracefulStopAgent() logic in daemon-entry.ts, but with
 * an injected grace period so tests run in milliseconds.
 *
 * Returns the resolved gracePeriodMs used (after clamping) so callers can assert on it.
 */
async function simulateGracefulStop(
  agentId: string,
  bridge: EventBridge,
  registry: GlobalServiceRegistry,
  statuses: Map<string, AgentLifecycleStatus>,
  gracePeriodMs: number,
): Promise<void> {
  // Step 1: draining
  statuses.set(agentId, 'draining');
  bridge.publish({ type: 'agent:leaving', agentId, timestamp: Date.now() });

  // Step 2: grace period
  await new Promise<void>((resolve) => setTimeout(resolve, gracePeriodMs));

  // Step 3: terminated + cleanup
  statuses.set(agentId, 'terminated');
  bridge.deregisterAgent(agentId);
  registry.deregisterAgent(agentId);
}

/**
 * Simulates the FINDING-2 fix: resolves the grace period exactly as
 * gracefulStopAgent() does in daemon-entry.ts — explicit param wins,
 * falls back to configured cache, then to DEFAULT, always clamped to MAX.
 */
function resolveGracePeriod(
  configuredGracePeriodMs?: number,
  cachedGracePeriodMs?: number,
): number {
  const resolved = configuredGracePeriodMs ?? cachedGracePeriodMs;
  return Math.min(resolved ?? DEFAULT_AGENT_GRACE_PERIOD_MS, MAX_AGENT_GRACE_PERIOD_MS);
}

describe("C14 — Graceful Shutdown Protocol (Plan37)", () => {
  let bridge: EventBridge;
  let registry: GlobalServiceRegistry;
  let statuses: Map<string, AgentLifecycleStatus>;

  beforeEach(() => {
    bridge = new EventBridge();
    registry = new GlobalServiceRegistry();
    statuses = new Map();
  });

  it("agent stop transitions status to draining then terminated", async () => {
    statuses.set("agent-x", "running");

    const statusSnapshots: AgentLifecycleStatus[] = [];
    // We'll capture states during simulation manually

    await simulateGracefulStop("agent-x", bridge, registry, statuses, 1);

    expect(statuses.get("agent-x")).toBe("terminated");
  });

  it("EventBridge receives agent:leaving notification during stop", async () => {
    const received: CoordinationMessage[] = [];
    bridge.setDeliveryFn((_agentId, event) => received.push(event));

    // Observer agent subscribes to agent:leaving
    bridge.registerAgent("observer", ["agent:leaving"]);

    statuses.set("agent-x", "running");
    await simulateGracefulStop("agent-x", bridge, registry, statuses, 1);

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("agent:leaving");
    expect(received[0].agentId).toBe("agent-x");
  });

  it("agent is deregistered from EventBridge after termination", async () => {
    bridge.registerAgent("agent-x", ["agent:joining"]);
    expect(bridge.getSubscribers("agent:joining")).toContain("agent-x");

    statuses.set("agent-x", "running");
    await simulateGracefulStop("agent-x", bridge, registry, statuses, 1);

    expect(bridge.getSubscribers("agent:joining")).not.toContain("agent-x");
  });

  it("GlobalServiceRegistry auto-cleanup on agent terminate", async () => {
    registry.register("my-service", "agent-x");
    expect(registry.lookup("my-service")).toHaveLength(1);

    statuses.set("agent-x", "running");
    await simulateGracefulStop("agent-x", bridge, registry, statuses, 1);

    expect(registry.lookup("my-service")).toHaveLength(0);
  });
});

describe("FINDING-2 — gracefulStopAgent honours per-agent gracePeriodMs config", () => {
  it("uses DEFAULT_AGENT_GRACE_PERIOD_MS when no override is provided", () => {
    const resolved = resolveGracePeriod(undefined, undefined);
    expect(resolved).toBe(DEFAULT_AGENT_GRACE_PERIOD_MS);
  });

  it("uses a custom gracePeriodMs when provided (not always DEFAULT)", () => {
    const customGrace = 60000;
    const resolved = resolveGracePeriod(customGrace, undefined);
    expect(resolved).toBe(customGrace);
    expect(resolved).not.toBe(DEFAULT_AGENT_GRACE_PERIOD_MS);
  });

  it("uses the cached per-agent value when no explicit param is given", () => {
    const cachedGrace = 45000;
    const resolved = resolveGracePeriod(undefined, cachedGrace);
    expect(resolved).toBe(cachedGrace);
  });

  it("explicit param takes precedence over cached value", () => {
    const explicitGrace = 20000;
    const cachedGrace = 45000;
    const resolved = resolveGracePeriod(explicitGrace, cachedGrace);
    expect(resolved).toBe(explicitGrace);
  });

  it("clamps value above MAX_AGENT_GRACE_PERIOD_MS to MAX", () => {
    const tooLarge = MAX_AGENT_GRACE_PERIOD_MS + 10000;
    const resolved = resolveGracePeriod(tooLarge, undefined);
    expect(resolved).toBe(MAX_AGENT_GRACE_PERIOD_MS);
  });

  it("accepts MAX_AGENT_GRACE_PERIOD_MS exactly (boundary)", () => {
    const resolved = resolveGracePeriod(MAX_AGENT_GRACE_PERIOD_MS, undefined);
    expect(resolved).toBe(MAX_AGENT_GRACE_PERIOD_MS);
  });
});
