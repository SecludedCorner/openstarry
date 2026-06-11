/**
 * Unit tests for CommChannelRegistry (Plan37 C6).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createCommChannelRegistry, type CommChannelRegistry } from "../../src/infrastructure/comm-channel-registry.js";
import type { ICommChannel, CommCapability, CommTopology, CommChannelStatus, CommMessage, CommMessageHandler } from "@openstarry/sdk";

function makeChannel(name: string, topology: CommTopology, caps: CommCapability[]): ICommChannel {
  return {
    name,
    version: "1.0.0",
    capabilities: caps,
    topology,
    getStatus(): CommChannelStatus { return 'disconnected'; },
    async connect(): Promise<void> {},
    async disconnect(): Promise<void> {},
  };
}

describe("CommChannelRegistry", () => {
  let registry: CommChannelRegistry;

  beforeEach(() => {
    registry = createCommChannelRegistry();
  });

  describe("register and get", () => {
    it("registers a channel and retrieves by name", () => {
      const ch = makeChannel("pipeline", "pipeline", ["messaging"]);
      registry.register(ch);
      expect(registry.get("pipeline")).toBe(ch);
    });

    it("returns undefined for unknown channel name", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });

    it("replaces existing channel with same name on re-register", () => {
      const ch1 = makeChannel("pipeline", "pipeline", ["messaging"]);
      const ch2 = makeChannel("pipeline", "pipeline", ["messaging", "rpc"]);
      registry.register(ch1);
      registry.register(ch2);
      expect(registry.get("pipeline")).toBe(ch2);
    });
  });

  describe("list", () => {
    it("returns empty array when no channels registered", () => {
      expect(registry.list()).toEqual([]);
    });

    it("returns all registered channels", () => {
      const ch1 = makeChannel("ch1", "point-to-point", ["messaging"]);
      const ch2 = makeChannel("ch2", "broadcast", ["streaming"]);
      registry.register(ch1);
      registry.register(ch2);
      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list).toContain(ch1);
      expect(list).toContain(ch2);
    });
  });

  describe("unregister", () => {
    it("removes a registered channel", () => {
      const ch = makeChannel("pipeline", "pipeline", ["messaging"]);
      registry.register(ch);
      registry.unregister("pipeline");
      expect(registry.get("pipeline")).toBeUndefined();
    });

    it("does not throw when unregistering non-existent channel", () => {
      expect(() => registry.unregister("nonexistent")).not.toThrow();
    });
  });

  describe("findByCapability", () => {
    it("returns channels that declare the given capability", () => {
      const messaging = makeChannel("a", "point-to-point", ["messaging"]);
      const rpc = makeChannel("b", "request-response", ["rpc"]);
      const both = makeChannel("c", "pipeline", ["messaging", "rpc"]);
      registry.register(messaging);
      registry.register(rpc);
      registry.register(both);

      const messagingChannels = registry.findByCapability("messaging");
      expect(messagingChannels).toHaveLength(2);
      expect(messagingChannels).toContain(messaging);
      expect(messagingChannels).toContain(both);
    });

    it("returns empty array if no channels have the capability", () => {
      const ch = makeChannel("a", "broadcast", ["streaming"]);
      registry.register(ch);
      expect(registry.findByCapability("rpc")).toEqual([]);
    });
  });

  describe("findByTopology", () => {
    it("returns channels with matching topology", () => {
      const pipeline = makeChannel("a", "pipeline", ["messaging"]);
      const p2p = makeChannel("b", "point-to-point", ["messaging"]);
      registry.register(pipeline);
      registry.register(p2p);

      const pipelineChannels = registry.findByTopology("pipeline");
      expect(pipelineChannels).toHaveLength(1);
      expect(pipelineChannels[0]).toBe(pipeline);
    });

    it("returns empty array if no channels match topology", () => {
      const ch = makeChannel("a", "broadcast", ["streaming"]);
      registry.register(ch);
      expect(registry.findByTopology("pipeline")).toEqual([]);
    });
  });
});
