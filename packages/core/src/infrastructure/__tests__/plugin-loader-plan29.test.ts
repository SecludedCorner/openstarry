/**
 * Tests for PluginLoader Plan29 features: monitors + auditor registration.
 * @see infrastructure/plugin-loader.ts
 */
import { describe, it, expect, vi } from "vitest";
import { createPluginLoader } from "../plugin-loader.js";
import type { IPlugin, IPluginContext, ILoopQualityMonitor, IConfidenceAuditor } from "@openstarry/sdk";
import type { MonitorRegistry } from "../monitor-registry.js";

function makeMinimalDeps(overrides: Record<string, unknown> = {}) {
  return {
    toolRegistry: { register: vi.fn() },
    providerRegistry: { register: vi.fn() },
    listenerRegistry: { register: vi.fn() },
    uiRegistry: { register: vi.fn() },
    guideRegistry: { register: vi.fn() },
    commandRegistry: { register: vi.fn() },
    ...overrides,
  } as any;
}

function makeCtx(): IPluginContext {
  return {
    bus: { emit: vi.fn(), on: vi.fn(() => () => {}), off: vi.fn() } as any,
    workingDirectory: "/test",
    agentId: "test-agent",
    config: {},
    pushInput: vi.fn(),
    sessions: {} as any,
  };
}

describe("PluginLoader — Plan29 monitors", () => {
  it("registers monitors from PluginHooks into MonitorRegistry", async () => {
    const monitorRegistry: MonitorRegistry = {
      register: vi.fn(),
      remove: vi.fn(() => true),
      list: vi.fn(() => []),
      startAll: vi.fn(),
      stopAll: vi.fn(),
    };
    const loader = createPluginLoader(makeMinimalDeps({ monitorRegistry }));
    const monitor: ILoopQualityMonitor = {
      id: "test-monitor",
      start: vi.fn(),
      stop: vi.fn(),
      getReport: () => null,
    };
    const plugin: IPlugin = {
      manifest: { name: "test-plugin", version: "1.0.0" },
      factory: async () => ({ monitors: [monitor] }),
    };
    await loader.load(plugin, makeCtx());
    expect(monitorRegistry.register).toHaveBeenCalledWith(monitor);
  });

  it("skips monitors registration when no monitorRegistry", async () => {
    const loader = createPluginLoader(makeMinimalDeps());
    const plugin: IPlugin = {
      manifest: { name: "test-plugin", version: "1.0.0" },
      factory: async () => ({ monitors: [{ id: "m1", start: vi.fn(), stop: vi.fn(), getReport: () => null }] }),
    };
    // Should not throw
    await loader.load(plugin, makeCtx());
  });
});

describe("PluginLoader — Plan29 auditor", () => {
  it("registers auditor (last-wins)", async () => {
    const loader = createPluginLoader(makeMinimalDeps());
    const auditor1: IConfidenceAuditor = {
      skandha: 'vijnana',
      id: 'auditor-1',
      audit: () => ({ delta: 0, reasoning: 'first' }),
    };
    const auditor2: IConfidenceAuditor = {
      skandha: 'vijnana',
      id: 'auditor-2',
      audit: () => ({ delta: 0.01, reasoning: 'second' }),
    };
    const plugin1: IPlugin = {
      manifest: { name: "p1", version: "1.0.0" },
      factory: async () => ({ auditor: auditor1 }),
    };
    const plugin2: IPlugin = {
      manifest: { name: "p2", version: "1.0.0" },
      factory: async () => ({ auditor: auditor2 }),
    };
    await loader.load(plugin1, makeCtx());
    await loader.load(plugin2, makeCtx());
    expect(loader.getAuditor()).toBe(auditor2);
  });

  it("getAuditor returns null when no plugin provides auditor", async () => {
    const loader = createPluginLoader(makeMinimalDeps());
    expect(loader.getAuditor()).toBeNull();
  });
});
