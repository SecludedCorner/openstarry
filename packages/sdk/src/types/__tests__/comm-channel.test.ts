/**
 * Type-level and runtime tests for ICommChannel types (Plan37 C5).
 */

import { describe, it, expect } from "vitest";
import type { ICommChannel, CommMessage, CommCapability, CommTopology, CommChannelStatus } from "../comm-channel.js";
import { CommCapabilityError } from "../comm-channel.js";

describe("CommCapabilityError", () => {
  it("constructs with correct message and properties", () => {
    const err = new CommCapabilityError("pipeline", "rpc", ["messaging"]);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CommCapabilityError);
    expect(err.name).toBe("CommCapabilityError");
    expect(err.channel).toBe("pipeline");
    expect(err.requiredCapability).toBe("rpc");
    expect(err.availableCapabilities).toEqual(["messaging"]);
    expect(err.message).toContain("pipeline");
    expect(err.message).toContain("rpc");
    expect(err.message).toContain("messaging");
  });
});

describe("CommMessage type compliance", () => {
  it("CommMessage.source is the correct field name (not from)", () => {
    const msg: CommMessage = {
      id: "uuid-1234",
      timestamp: Date.now(),
      source: "agent-a",
      target: "agent-b",
      payload: { text: "hello" },
      performative: "inform",
      traceId: "trace-1",
      traceDepth: 1,
      timeoutMs: 5000,
      correlationId: "corr-1",
    };
    expect(msg.source).toBe("agent-a");
    expect(msg.target).toBe("agent-b");
    expect(msg.payload).toEqual({ text: "hello" });
  });

  it("CommMessage target is optional (broadcast support)", () => {
    const msg: CommMessage = {
      id: "broadcast-1",
      timestamp: Date.now(),
      source: "orchestrator",
      payload: "broadcast payload",
    };
    expect(msg.target).toBeUndefined();
  });
});

describe("ICommChannel interface compliance", () => {
  it("a minimal implementation satisfies the interface", () => {
    const channel: ICommChannel = {
      name: "test-channel",
      version: "1.0.0",
      capabilities: ["messaging"] as const,
      topology: "point-to-point" as CommTopology,
      getStatus(): CommChannelStatus { return "disconnected"; },
      async connect(): Promise<void> {},
      async disconnect(): Promise<void> {},
    };

    expect(channel.name).toBe("test-channel");
    expect(channel.capabilities).toContain("messaging");
    expect(channel.topology).toBe("point-to-point");
    expect(channel.getStatus()).toBe("disconnected");
  });

  it("CommChannelStatus values are correct", () => {
    const statuses: CommChannelStatus[] = [
      "disconnected", "connecting", "connected", "draining", "error"
    ];
    expect(statuses).toHaveLength(5);
    expect(statuses).toContain("draining");
  });

  it("CommCapability values are correct", () => {
    const caps: CommCapability[] = ["messaging", "streaming", "rpc", "composable"];
    expect(caps).toHaveLength(4);
  });
});
