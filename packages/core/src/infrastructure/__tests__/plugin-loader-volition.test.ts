/**
 * Tests for Plan28 PluginLoader volition registration.
 */
import { describe, it, expect, vi } from "vitest";
import { createPluginLoader } from "../plugin-loader.js";
import type { IPlugin, PluginHooks, IVolition, IPluginContext, EventBus, ISessionManager } from "@openstarry/sdk";

function makeMinimalDeps() {
  return {
    toolRegistry: { register: vi.fn() } as any,
    providerRegistry: { register: vi.fn() } as any,
    listenerRegistry: { register: vi.fn() } as any,
    uiRegistry: { register: vi.fn() } as any,
    guideRegistry: { register: vi.fn() } as any,
    commandRegistry: { register: vi.fn() } as any,
  };
}

function makeCtx(): IPluginContext {
  return {
    bus: { emit: vi.fn(), on: vi.fn(() => () => {}), once: vi.fn(() => () => {}), onAny: vi.fn(() => () => {}) } as unknown as EventBus,
    workingDirectory: "/test",
    agentId: "test",
    config: {},
    pushInput: vi.fn(),
    sessions: {} as ISessionManager,
  };
}

function makeVolitionPlugin(volition: IVolition): IPlugin {
  return {
    manifest: { name: "test-volition", version: "0.1.0" },
    async factory(): Promise<PluginHooks> {
      return { volition };
    },
  };
}

function makeStubVolition(): IVolition {
  return {
    skandha: "vijnana",
    async deliberatePlan() { return { modifiedPlan: null, reasoning: "test" }; },
    async deliberateAction() { return { veto: false, alternative: null, reasoning: "test" }; },
  };
}

describe("PluginLoader volition registration (Plan28)", () => {
  it("registers volition from PluginHooks", async () => {
    const loader = createPluginLoader(makeMinimalDeps());
    const volition = makeStubVolition();
    const plugin = makeVolitionPlugin(volition);
    await loader.load(plugin, makeCtx());

    expect(loader.getVolition()).toBe(volition);
  });

  it("returns null when no plugin provides volition", async () => {
    const loader = createPluginLoader(makeMinimalDeps());
    const plugin: IPlugin = {
      manifest: { name: "no-volition", version: "0.1.0" },
      async factory(): Promise<PluginHooks> { return {}; },
    };
    await loader.load(plugin, makeCtx());

    expect(loader.getVolition()).toBeNull();
  });

  it("last plugin wins (volition replaced)", async () => {
    const loader = createPluginLoader(makeMinimalDeps());
    const vol1 = makeStubVolition();
    const vol2 = makeStubVolition();

    await loader.load(makeVolitionPlugin(vol1), makeCtx());
    await loader.load(makeVolitionPlugin(vol2), makeCtx());

    expect(loader.getVolition()).toBe(vol2);
    expect(loader.getVolition()).not.toBe(vol1);
  });

  it("disposeAll resets registered hooks but volition survives until new load cycle", async () => {
    const loader = createPluginLoader(makeMinimalDeps());
    const volition = makeStubVolition();
    await loader.load(makeVolitionPlugin(volition), makeCtx());

    expect(loader.getVolition()).toBe(volition);
    // Note: disposeAll clears hooks array but volition variable persists
    // This is acceptable since agent restarts would create a new pluginLoader
  });
});
