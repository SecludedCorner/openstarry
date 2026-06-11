import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventBridge } from "../../src/daemon/event-bridge.js";
import type { CoordinationMessage } from "../../src/daemon/event-bridge.js";

function makeEvent(type: CoordinationMessage["type"], agentId: string): CoordinationMessage {
  return { type, agentId, timestamp: Date.now() };
}

describe("C12 — EventBridge (Plan37, D2-R7)", () => {
  let bridge: EventBridge;

  beforeEach(() => {
    bridge = new EventBridge();
  });

  it("publish delivers to subscribed agents", () => {
    const delivered: Array<{ agentId: string; event: CoordinationMessage }> = [];
    bridge.setDeliveryFn((agentId, event) => delivered.push({ agentId, event }));

    bridge.registerAgent("agent-a", ["agent:joining"]);
    bridge.registerAgent("agent-b", ["agent:joining"]);

    bridge.publish(makeEvent("agent:joining", "agent-c"));

    expect(delivered).toHaveLength(2);
    expect(delivered.map(d => d.agentId).sort()).toEqual(["agent-a", "agent-b"]);
  });

  it("publish does NOT deliver to the originating agent", () => {
    const delivered: string[] = [];
    bridge.setDeliveryFn((agentId) => delivered.push(agentId));

    bridge.registerAgent("agent-a", ["agent:leaving"]);
    bridge.registerAgent("agent-b", ["agent:leaving"]);

    // agent-a is the originating agent
    bridge.publish(makeEvent("agent:leaving", "agent-a"));

    expect(delivered).not.toContain("agent-a");
    expect(delivered).toContain("agent-b");
  });

  it("publish respects per-agent whitelist", () => {
    const delivered: string[] = [];
    bridge.setDeliveryFn((agentId) => delivered.push(agentId));

    // agent-a subscribes to agent:joining only
    bridge.registerAgent("agent-a", ["agent:joining"]);
    // agent-b subscribes to agent:status_changed only
    bridge.registerAgent("agent-b", ["agent:status_changed"]);

    bridge.publish(makeEvent("agent:joining", "agent-x"));

    // Only agent-a should receive agent:joining
    expect(delivered).toContain("agent-a");
    expect(delivered).not.toContain("agent-b");
  });

  it("deregisterAgent removes all subscriptions", () => {
    const delivered: string[] = [];
    bridge.setDeliveryFn((agentId) => delivered.push(agentId));

    bridge.registerAgent("agent-a", ["agent:joining", "agent:leaving"]);
    bridge.deregisterAgent("agent-a");

    bridge.publish(makeEvent("agent:joining", "agent-x"));
    bridge.publish(makeEvent("agent:leaving", "agent-x"));

    expect(delivered).toHaveLength(0);
    expect(bridge.getSubscribers("agent:joining")).not.toContain("agent-a");
    expect(bridge.getSubscribers("agent:leaving")).not.toContain("agent-a");
  });

  it("delivery failure is fail-open (no throw)", () => {
    bridge.setDeliveryFn(() => {
      throw new Error("IPC write failed");
    });

    bridge.registerAgent("agent-a", ["agent:joining"]);

    // Must not throw
    expect(() => bridge.publish(makeEvent("agent:joining", "agent-x"))).not.toThrow();
  });
});
