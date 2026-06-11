/**
 * Tests for PluginLoader Plan33 features:
 * - Plugin manifest.dependencies (OQ-33-1)
 * - Plugin manifest.criticality (OQ-33-3)
 * - Skandha check integration (02-8 T3)
 */
import { describe, it, expect, vi } from "vitest";
import { createPluginLoader } from "../plugin-loader.js";
import type { IPlugin, IPluginContext, EventBus } from "@openstarry/sdk";

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

function makePlugin(name: string, overrides: Record<string, unknown> = {}): IPlugin {
  return {
    manifest: { name, version: "1.0.0", ...overrides },
    factory: async () => ({}),
  };
}

describe("PluginLoader — Plan33 dependencies (OQ-33-1)", () => {
  it("loads plugins in dependency order", async () => {
    const order: string[] = [];
    const pluginA: IPlugin = {
      manifest: { name: "plugin-a", version: "1.0.0" },
      factory: async () => { order.push("a"); return {}; },
    };
    const pluginB: IPlugin = {
      manifest: { name: "plugin-b", version: "1.0.0", dependencies: ["plugin-a"] },
      factory: async () => { order.push("b"); return {}; },
    };
    const loader = createPluginLoader(makeMinimalDeps());
    await loader.loadAll([pluginB, pluginA], () => makeCtx());
    expect(order).toEqual(["a", "b"]);
  });

  it("skips plugin when dependency is missing (KD-1)", async () => {
    const pluginB: IPlugin = {
      manifest: { name: "plugin-b", version: "1.0.0", dependencies: ["nonexistent"] },
      factory: async () => ({}),
    };
    const loader = createPluginLoader(makeMinimalDeps());
    await loader.loadAll([pluginB], () => makeCtx());
    // Plugin was skipped — loadedHooks should be empty
    expect(loader.getLoadedHooks()).toHaveLength(0);
  });

  it("loads independent plugins preserving config order", async () => {
    const order: string[] = [];
    const p1: IPlugin = {
      manifest: { name: "p1", version: "1.0.0" },
      factory: async () => { order.push("p1"); return {}; },
    };
    const p2: IPlugin = {
      manifest: { name: "p2", version: "1.0.0" },
      factory: async () => { order.push("p2"); return {}; },
    };
    const loader = createPluginLoader(makeMinimalDeps());
    await loader.loadAll([p1, p2], () => makeCtx());
    expect(order).toEqual(["p1", "p2"]);
  });
});

describe("PluginLoader — Plan33 criticality (OQ-33-3)", () => {
  it("loads plugin with criticality field in manifest", async () => {
    const plugin = makePlugin("test-critical", { criticality: "required" });
    const loader = createPluginLoader(makeMinimalDeps());
    await loader.loadAll([plugin], () => makeCtx());
    expect(loader.getLoadedHooks()).toHaveLength(1);
  });

  it("criticality field is accessible on manifest", () => {
    const plugin = makePlugin("test-critical", {
      criticality: "optional-degraded",
      skandha: "samskara",
    });
    expect((plugin.manifest as any).criticality).toBe("optional-degraded");
  });
});

describe("PluginLoader — Plan33 skandha check integration (02-8 T3)", () => {
  it("emits skandha:mismatch event when violations detected", async () => {
    const bus: EventBus = {
      emit: vi.fn(),
      on: vi.fn(() => () => {}),
      off: vi.fn(),
      once: vi.fn(() => () => {}),
      onAny: vi.fn(() => () => {}),
    } as any;
    const loader = createPluginLoader(makeMinimalDeps({ bus }));
    // Plugin declares no skandha but registers tools → sigma-15 WARN
    const plugin: IPlugin = {
      manifest: { name: "overclaimer", version: "1.0.0" },
      factory: async () => ({ tools: [{ name: "t1", execute: vi.fn() } as any] }),
    };
    await loader.load(plugin, makeCtx());
    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "skandha:mismatch",
        payload: expect.objectContaining({
          pluginName: "overclaimer",
          violations: expect.arrayContaining([
            expect.objectContaining({ constraintId: "sigma-15" }),
          ]),
        }),
      }),
    );
  });

  it("does not emit event when no violations", async () => {
    const bus: EventBus = {
      emit: vi.fn(),
      on: vi.fn(() => () => {}),
      off: vi.fn(),
      once: vi.fn(() => () => {}),
      onAny: vi.fn(() => () => {}),
    } as any;
    const loader = createPluginLoader(makeMinimalDeps({ bus }));
    const plugin: IPlugin = {
      manifest: { name: "clean-plugin", version: "1.0.0", skandha: "samskara" as any },
      factory: async () => ({ tools: [{ name: "t1", execute: vi.fn() } as any] }),
    };
    await loader.load(plugin, makeCtx());
    // Should not have emitted skandha:mismatch
    const mismatchCalls = (bus.emit as any).mock.calls.filter(
      (c: any[]) => c[0]?.type === "skandha:mismatch",
    );
    expect(mismatchCalls).toHaveLength(0);
  });

  it("does not emit event when no bus configured", async () => {
    // No bus → no error thrown
    const loader = createPluginLoader(makeMinimalDeps());
    const plugin: IPlugin = {
      manifest: { name: "no-bus", version: "1.0.0" },
      factory: async () => ({ tools: [{ name: "t1", execute: vi.fn() } as any] }),
    };
    // Should not throw
    await expect(loader.load(plugin, makeCtx())).resolves.toBeDefined();
  });
});
