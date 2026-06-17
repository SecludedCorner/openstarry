import { describe, it, expect } from "vitest";
import { CompositeChannel, MAX_COMPOSITION_DEPTH } from "../../src/daemon/composite-channel.js";
import type { ICommChannel, CommMessage, CommCapability, CommMessageHandler } from "@openstarry/sdk";

interface FakeChannel extends ICommChannel {
  sent: CommMessage[];
  emit(msg: CommMessage, from: string): void;
  connectCount: number;
  disconnectCount: number;
}

function fakeChannel(
  name: string,
  capabilities: CommCapability[] = ['messaging', 'composable'],
  opts: { failSend?: boolean } = {},
): FakeChannel {
  const sent: CommMessage[] = [];
  const handlers: CommMessageHandler[] = [];
  const ch: FakeChannel = {
    name,
    version: '1.0.0',
    capabilities,
    topology: 'point-to-point',
    sent,
    connectCount: 0,
    disconnectCount: 0,
    getStatus: () => 'connected',
    connect: async () => { ch.connectCount++; },
    disconnect: async () => { ch.disconnectCount++; },
    send: async (_target, msg) => {
      if (opts.failSend) throw new Error(`${name} send failed`);
      sent.push(msg);
    },
    onMessage: (h) => {
      handlers.push(h);
      return () => {
        const i = handlers.indexOf(h);
        if (i >= 0) handlers.splice(i, 1);
      };
    },
    emit: (msg, from) => { for (const h of [...handlers]) h(msg, from); },
  };
  return ch;
}

function msg(id = "m1"): CommMessage {
  return { id, source: "a", target: "b", payload: {}, timestamp: Date.now(), performative: "inform" };
}

describe("CompositeChannel (Doc 53 §11 — composition model)", () => {
  describe("construction + constraints", () => {
    it("capabilities = intersection of children", () => {
      const a = fakeChannel("a", ['messaging', 'composable', 'streaming']);
      const b = fakeChannel("b", ['messaging', 'composable']);
      const composite = new CompositeChannel("c", [a, b], 'fallback');
      expect([...composite.capabilities].sort()).toEqual(['composable', 'messaging']);
    });

    it("rejects a non-composable child", () => {
      const a = fakeChannel("a", ['messaging', 'composable']);
      const b = fakeChannel("b", ['messaging']); // not composable
      expect(() => new CompositeChannel("c", [a, b], 'fallback')).toThrow(/not composable/);
    });

    it("rejects empty children", () => {
      expect(() => new CompositeChannel("c", [], 'fallback')).toThrow(/at least one/);
    });

    it("composite of leaves has depth 1 and is itself composable (nestable)", () => {
      const composite = new CompositeChannel("c", [fakeChannel("a")], 'fallback');
      expect(composite.compositionDepth).toBe(1);
      expect(composite.capabilities).toContain('composable');
    });

    it(`rejects nesting beyond MAX_COMPOSITION_DEPTH (${MAX_COMPOSITION_DEPTH})`, () => {
      const d1 = new CompositeChannel("d1", [fakeChannel("a")], 'fallback');       // depth 1
      const d2 = new CompositeChannel("d2", [d1], 'fallback');                      // depth 2
      const d3 = new CompositeChannel("d3", [d2], 'fallback');                      // depth 3
      expect(d3.compositionDepth).toBe(3);
      expect(() => new CompositeChannel("d4", [d3], 'fallback')).toThrow(/exceeds MAX_COMPOSITION_DEPTH/);
    });
  });

  describe("fallback strategy", () => {
    it("first success wins; secondary not used", async () => {
      const a = fakeChannel("a");
      const b = fakeChannel("b");
      const c = new CompositeChannel("c", [a, b], 'fallback');
      await c.send("b", msg());
      expect(a.sent).toHaveLength(1);
      expect(b.sent).toHaveLength(0);
    });

    it("falls through to secondary when primary fails", async () => {
      const a = fakeChannel("a", ['messaging', 'composable'], { failSend: true });
      const b = fakeChannel("b");
      const c = new CompositeChannel("c", [a, b], 'fallback');
      await c.send("b", msg());
      expect(b.sent).toHaveLength(1);
    });

    it("throws when all children fail", async () => {
      const a = fakeChannel("a", ['messaging', 'composable'], { failSend: true });
      const b = fakeChannel("b", ['messaging', 'composable'], { failSend: true });
      const c = new CompositeChannel("c", [a, b], 'fallback');
      await expect(c.send("b", msg())).rejects.toThrow(/fallback exhausted/);
    });
  });

  describe("broadcast strategy", () => {
    it("sends to all children", async () => {
      const a = fakeChannel("a");
      const b = fakeChannel("b");
      const c = new CompositeChannel("c", [a, b], 'broadcast');
      await c.send("b", msg());
      expect(a.sent).toHaveLength(1);
      expect(b.sent).toHaveLength(1);
    });

    it("succeeds if at least one child delivers (best-effort)", async () => {
      const a = fakeChannel("a", ['messaging', 'composable'], { failSend: true });
      const b = fakeChannel("b");
      const c = new CompositeChannel("c", [a, b], 'broadcast');
      await expect(c.send("b", msg())).resolves.toBeUndefined();
      expect(b.sent).toHaveLength(1);
    });

    it("throws when all children fail", async () => {
      const a = fakeChannel("a", ['messaging', 'composable'], { failSend: true });
      const b = fakeChannel("b", ['messaging', 'composable'], { failSend: true });
      const c = new CompositeChannel("c", [a, b], 'broadcast');
      await expect(c.send("b", msg())).rejects.toThrow(/broadcast failed on all/);
    });
  });

  describe("pipeline strategy", () => {
    it("delivers through all children sequentially", async () => {
      const a = fakeChannel("a");
      const b = fakeChannel("b");
      const c = new CompositeChannel("c", [a, b], 'pipeline');
      await c.send("b", msg());
      expect(a.sent).toHaveLength(1);
      expect(b.sent).toHaveLength(1);
    });

    it("throws if any stage fails", async () => {
      const a = fakeChannel("a");
      const b = fakeChannel("b", ['messaging', 'composable'], { failSend: true });
      const c = new CompositeChannel("c", [a, b], 'pipeline');
      await expect(c.send("b", msg())).rejects.toThrow(/send failed/);
    });
  });

  describe("capability + lifecycle", () => {
    it("send throws CommCapabilityError when intersection lacks messaging", async () => {
      // both composable but neither messaging -> intersection has no 'messaging'
      const a = fakeChannel("a", ['composable', 'streaming']);
      const b = fakeChannel("b", ['composable', 'streaming']);
      const c = new CompositeChannel("c", [a, b], 'broadcast');
      await expect(c.send("b", msg())).rejects.toThrow(/does not support "messaging"/);
    });

    it("connect/disconnect delegate to all children", async () => {
      const a = fakeChannel("a");
      const b = fakeChannel("b");
      const c = new CompositeChannel("c", [a, b], 'fallback');
      await c.connect();
      expect(c.getStatus()).toBe('connected');
      expect(a.connectCount).toBe(1);
      expect(b.connectCount).toBe(1);
      await c.disconnect();
      expect(c.getStatus()).toBe('disconnected');
      expect(a.disconnectCount).toBe(1);
    });

    it("onMessage fans in from all children; unsubscribe detaches all", () => {
      const a = fakeChannel("a");
      const b = fakeChannel("b");
      const c = new CompositeChannel("c", [a, b], 'broadcast');
      const received: string[] = [];
      const unsub = c.onMessage((m) => received.push(m.id));
      a.emit(msg("from-a"), "a");
      b.emit(msg("from-b"), "b");
      expect(received).toEqual(["from-a", "from-b"]);
      unsub();
      a.emit(msg("after-unsub"), "a");
      expect(received).toEqual(["from-a", "from-b"]);
    });
  });
});
