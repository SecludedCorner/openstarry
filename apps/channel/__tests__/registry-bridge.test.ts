/**
 * Tests for Plan39 W3: RegistryEventBus + RegistryBridge
 *
 * Coverage:
 * - AC-W3-2: Channel registry converges with Daemon registry within one event cycle
 * - AC-W3-3: Channel-originated identity claims rejected (Daemon-authoritative invariant)
 * - AC-W3-4: IRegistryEventBus is PROVISIONAL
 * - AC-W3-5: AT-7a/b/c attack vectors closed
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentRegistry } from "../src/registry.js";
import { RegistryEventBus } from "../src/registry-event-bus.js";
import { RegistryBridge } from "../src/registry-bridge.js";
import type { RegistryEvent } from "@openstarry/sdk";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  type: RegistryEvent['type'],
  agentId: string,
  payload?: unknown,
): RegistryEvent {
  return { type, agentId, timestamp: Date.now(), payload };
}

/** Wait a tick so async lock acquisitions complete. */
function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 10));
}

// ---------------------------------------------------------------------------
// RegistryEventBus unit tests
// ---------------------------------------------------------------------------

describe("RegistryEventBus (Plan39 W3, AC-W3-4)", () => {
  it("isReady() returns false before setReady(true)", () => {
    const bus = new RegistryEventBus();
    expect(bus.isReady()).toBe(false);
  });

  it("isReady() returns true after setReady(true)", () => {
    const bus = new RegistryEventBus();
    bus.setReady(true);
    expect(bus.isReady()).toBe(true);
  });

  it("isReady() returns false after setReady(false)", () => {
    const bus = new RegistryEventBus();
    bus.setReady(true);
    bus.setReady(false);
    expect(bus.isReady()).toBe(false);
  });

  it("on() receives emitted events for subscribed type", () => {
    const bus = new RegistryEventBus();
    const received: RegistryEvent[] = [];
    bus.on('agent:spawned', (e) => received.push(e));

    const event = makeEvent('agent:spawned', 'agent-1', { pid: 1234 });
    bus.emit(event);

    expect(received).toHaveLength(1);
    expect(received[0].agentId).toBe('agent-1');
  });

  it("on() does not receive events for other types", () => {
    const bus = new RegistryEventBus();
    const received: RegistryEvent[] = [];
    bus.on('agent:terminated', (e) => received.push(e));

    bus.emit(makeEvent('agent:spawned', 'agent-1', { pid: 1 }));

    expect(received).toHaveLength(0);
  });

  it("on() unsubscribe removes handler", () => {
    const bus = new RegistryEventBus();
    const received: RegistryEvent[] = [];
    const unsub = bus.on('agent:spawned', (e) => received.push(e));

    unsub();
    bus.emit(makeEvent('agent:spawned', 'agent-1', { pid: 1 }));

    expect(received).toHaveLength(0);
  });

  it("handler errors do not propagate (fail-open)", () => {
    const bus = new RegistryEventBus();
    bus.on('agent:spawned', () => { throw new Error("boom"); });

    expect(() => bus.emit(makeEvent('agent:spawned', 'agent-1', { pid: 1 }))).not.toThrow();
  });

  it("multiple handlers for same type all receive event", () => {
    const bus = new RegistryEventBus();
    let count = 0;
    bus.on('agent:registered', () => count++);
    bus.on('agent:registered', () => count++);

    bus.emit(makeEvent('agent:registered', 'agent-2'));

    expect(count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// RegistryBridge unit tests (AC-W3-2, AC-W3-3, AC-W3-5)
// ---------------------------------------------------------------------------

describe("RegistryBridge (Plan39 W3)", () => {
  let registry: AgentRegistry;
  let bus: RegistryEventBus;
  let bridge: RegistryBridge;

  beforeEach(() => {
    registry = new AgentRegistry();
    bus = new RegistryEventBus();
    bus.setReady(true);
    bridge = new RegistryBridge(bus, registry, 'test-ch');
    bridge.attach();
  });

  afterEach(() => {
    bridge.dispose();
    registry.stopHeartbeatMonitor();
  });

  // -------------------------------------------------------------------------
  // AC-W3-2: Registry converges within one event cycle
  // -------------------------------------------------------------------------

  it("AC-W3-2: agent:spawned registers agent in read-replica", async () => {
    bus.emit(makeEvent('agent:spawned', 'agent-1', { pid: 1234 }));
    await tick();

    await registry.lock.acquireRead();
    const exists = registry.has('agent-1');
    registry.lock.releaseRead();

    expect(exists).toBe(true);
  });

  it("AC-W3-2: agent:terminated deregisters agent from read-replica", async () => {
    bus.emit(makeEvent('agent:spawned', 'agent-1', { pid: 1234 }));
    await tick();

    bus.emit(makeEvent('agent:terminated', 'agent-1'));
    await tick();

    await registry.lock.acquireRead();
    const exists = registry.has('agent-1');
    registry.lock.releaseRead();

    expect(exists).toBe(false);
  });

  it("AC-W3-2: agent:registered updates mcpEndpoint on existing entry", async () => {
    bus.emit(makeEvent('agent:spawned', 'agent-1', { pid: 1234 }));
    await tick();

    bus.emit(makeEvent('agent:registered', 'agent-1', {
      mcpEndpoint: 'http://localhost:9000',
    }));
    await tick();

    await registry.lock.acquireRead();
    const entry = registry.get('agent-1');
    registry.lock.releaseRead();

    expect(entry?.mcpEndpoint).toBe('http://localhost:9000');
  });

  it("AC-W3-2: agent:health_changed updates health on existing entry", async () => {
    bus.emit(makeEvent('agent:spawned', 'agent-1', { pid: 1234 }));
    await tick();

    bus.emit(makeEvent('agent:health_changed', 'agent-1', { health: 'DEGRADED' }));
    await tick();

    await registry.lock.acquireRead();
    const entry = registry.get('agent-1');
    registry.lock.releaseRead();

    expect(entry?.health).toBe('DEGRADED');
  });

  // -------------------------------------------------------------------------
  // AC-W3-3: Channel-originated identity claims rejected
  // -------------------------------------------------------------------------

  it("AC-W3-3: agent:registered without prior agent:spawned is rejected", async () => {
    // No agent:spawned has been emitted; this simulates a Channel-originated claim.
    bus.emit(makeEvent('agent:registered', 'ghost-agent', {
      mcpEndpoint: 'http://evil.example.com',
    }));
    await tick();

    await registry.lock.acquireRead();
    const exists = registry.has('ghost-agent');
    registry.lock.releaseRead();

    // AT-7a: Ghost Agent — must not appear in registry without Daemon attestation.
    expect(exists).toBe(false);
  });

  // -------------------------------------------------------------------------
  // AC-W3-5: AT-7 attack vectors closed
  // -------------------------------------------------------------------------

  it("AT-7a (Ghost Agent): agent:registered without agent:spawned creates no entry", async () => {
    bus.emit(makeEvent('agent:registered', 'ghost-1', { pid: 9999 }));
    await tick();

    await registry.lock.acquireRead();
    const exists = registry.has('ghost-1');
    registry.lock.releaseRead();

    expect(exists).toBe(false);
  });

  it("AT-7b (Shadow Agent): duplicate agent:spawned is rejected", async () => {
    bus.emit(makeEvent('agent:spawned', 'shadow-agent', { pid: 1111 }));
    await tick();
    bus.emit(makeEvent('agent:spawned', 'shadow-agent', { pid: 2222 }));
    await tick();

    // Only one entry exists; pid should be the first (legitimate) one.
    await registry.lock.acquireRead();
    const entry = registry.get('shadow-agent');
    const count = registry.size;
    registry.lock.releaseRead();

    expect(count).toBe(1);
    expect(entry?.pid).toBe(1111);
  });

  it("AT-7c (Identity Split): terminate before re-spawn clears registry correctly", async () => {
    // Spawn, terminate, re-spawn.
    bus.emit(makeEvent('agent:spawned', 'split-agent', { pid: 3000 }));
    await tick();
    bus.emit(makeEvent('agent:terminated', 'split-agent'));
    await tick();
    bus.emit(makeEvent('agent:spawned', 'split-agent', { pid: 3001 }));
    await tick();

    await registry.lock.acquireRead();
    const entry = registry.get('split-agent');
    registry.lock.releaseRead();

    // New entry must have the new pid.
    expect(entry?.pid).toBe(3001);
  });

  it("dispose() removes all subscriptions", async () => {
    bridge.dispose();
    bus.emit(makeEvent('agent:spawned', 'agent-after-dispose', { pid: 5678 }));
    await tick();

    await registry.lock.acquireRead();
    const exists = registry.has('agent-after-dispose');
    registry.lock.releaseRead();

    expect(exists).toBe(false);
  });

  it("agent:spawned missing pid is ignored", async () => {
    bus.emit(makeEvent('agent:spawned', 'no-pid-agent', { someOtherField: true }));
    await tick();

    await registry.lock.acquireRead();
    const exists = registry.has('no-pid-agent');
    registry.lock.releaseRead();

    expect(exists).toBe(false);
  });

  it("agent:health_changed for unknown agent is ignored without error", async () => {
    expect(() => {
      bus.emit(makeEvent('agent:health_changed', 'unknown-agent', { health: 'DEGRADED' }));
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Lifecycle integration: Channel emits structured READY JSON (AC-W3-1)
// ---------------------------------------------------------------------------

describe("Channel READY signal (Plan39 W3, AC-W3-1)", () => {
  it("start() emits structured ReadySignal JSON on stdout", async () => {
    const { Channel } = await import("../src/index.js");
    const written: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    const channel = new Channel({ channelId: "ready-test-ch", gracePeriodMs: 10 });
    await channel.start();
    channel.forceTerminate();

    writeSpy.mockRestore();

    // Should have exactly one READY line.
    expect(written).toHaveLength(1);
    const parsed = JSON.parse(written[0].trim()) as Record<string, unknown>;
    expect(parsed.type).toBe('READY');
    expect(parsed.channelId).toBe('ready-test-ch');
    expect(typeof parsed.timestamp).toBe('number');
    expect(typeof parsed.version).toBe('string');
  });

  it("start() marks eventBus ready after READY signal", async () => {
    const { Channel } = await import("../src/index.js");
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const channel = new Channel({ channelId: "bus-ready-ch", gracePeriodMs: 10 });
    expect(channel.eventBus.isReady()).toBe(false);

    await channel.start();
    expect(channel.eventBus.isReady()).toBe(true);

    channel.forceTerminate();
    writeSpy.mockRestore();
  });

  it("forceTerminate() marks eventBus not ready", async () => {
    const { Channel } = await import("../src/index.js");
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const channel = new Channel({ channelId: "term-ch", gracePeriodMs: 10 });
    await channel.start();
    channel.forceTerminate();

    expect(channel.eventBus.isReady()).toBe(false);

    writeSpy.mockRestore();
  });
});
