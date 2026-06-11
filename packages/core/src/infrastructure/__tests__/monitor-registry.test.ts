/**
 * Tests for MonitorRegistry.
 * @see infrastructure/monitor-registry.ts
 */
import { describe, it, expect, vi } from "vitest";
import { createMonitorRegistry } from "../monitor-registry.js";
import type { ILoopQualityMonitor, EventBus } from "@openstarry/sdk";

function makeMonitor(id: string): ILoopQualityMonitor {
  return {
    id,
    start: vi.fn(),
    stop: vi.fn(),
    getReport: () => null,
  };
}

function makeBus(): EventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(() => () => {}),
    off: vi.fn(),
  } as unknown as EventBus;
}

describe("MonitorRegistry", () => {
  it("registers and lists monitors", () => {
    const registry = createMonitorRegistry();
    const m1 = makeMonitor("m1");
    const m2 = makeMonitor("m2");
    registry.register(m1);
    registry.register(m2);
    expect(registry.list()).toHaveLength(2);
    expect(registry.list().map(m => m.id)).toEqual(["m1", "m2"]);
  });

  it("replaces existing monitor with same id", () => {
    const registry = createMonitorRegistry();
    const m1 = makeMonitor("m1");
    const m1v2 = makeMonitor("m1");
    registry.register(m1);
    registry.register(m1v2);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]).toBe(m1v2);
  });

  it("removes a monitor by id", () => {
    const registry = createMonitorRegistry();
    registry.register(makeMonitor("m1"));
    expect(registry.remove("m1")).toBe(true);
    expect(registry.list()).toHaveLength(0);
  });

  it("remove returns false for unknown id", () => {
    const registry = createMonitorRegistry();
    expect(registry.remove("nonexistent")).toBe(false);
  });

  it("startAll calls start(bus) on all monitors", () => {
    const registry = createMonitorRegistry();
    const m1 = makeMonitor("m1");
    const m2 = makeMonitor("m2");
    registry.register(m1);
    registry.register(m2);
    const bus = makeBus();
    registry.startAll(bus);
    expect(m1.start).toHaveBeenCalledWith(bus);
    expect(m2.start).toHaveBeenCalledWith(bus);
  });

  it("stopAll calls stop() on all monitors", () => {
    const registry = createMonitorRegistry();
    const m1 = makeMonitor("m1");
    const m2 = makeMonitor("m2");
    registry.register(m1);
    registry.register(m2);
    registry.stopAll();
    expect(m1.stop).toHaveBeenCalled();
    expect(m2.stop).toHaveBeenCalled();
  });

  it("empty registry: startAll/stopAll are no-ops", () => {
    const registry = createMonitorRegistry();
    const bus = makeBus();
    expect(() => registry.startAll(bus)).not.toThrow();
    expect(() => registry.stopAll()).not.toThrow();
  });
});
