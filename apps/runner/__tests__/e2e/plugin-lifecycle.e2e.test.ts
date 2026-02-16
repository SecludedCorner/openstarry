/**
 * E2E Tests: Plugin Lifecycle
 * Tests plugin loading, initialization, and disposal.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAgentFixture, type IAgentTestFixture } from "./helpers/index.js";
import { AgentEventType, type IPlugin, type IPluginContext, type PluginHooks } from "@openstarry/sdk";

describe("E2E: Plugin Lifecycle", () => {
  let fixture: IAgentTestFixture;

  beforeEach(() => {
    fixture = createAgentFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("should load single plugin successfully", async () => {
    const plugin: IPlugin = {
      manifest: {
        name: "test-plugin",
        version: "0.1.0",
        description: "Test plugin",
        sandbox: { enabled: false }, // Disable sandbox for inline test plugin
      },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        return {
          listeners: [],
          ui: [],
          tools: [],
          guides: [],
          providers: [],
          commands: [],
        };
      },
    };

    await fixture.core.loadPlugin(plugin);

    const pluginLoadedEvent = fixture.events.find(
      (e) => e.type === AgentEventType.PLUGIN_LOADED,
    );
    expect(pluginLoadedEvent).toBeDefined();
    expect(pluginLoadedEvent?.payload).toMatchObject({ name: "test-plugin" });
  });

  it("should load multiple plugins in order", async () => {
    const plugin1: IPlugin = {
      manifest: { name: "plugin-1", version: "0.1.0", description: "Plugin 1", sandbox: { enabled: false } },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        return {};
      },
    };

    const plugin2: IPlugin = {
      manifest: { name: "plugin-2", version: "0.1.0", description: "Plugin 2", sandbox: { enabled: false } },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        return {};
      },
    };

    await fixture.core.loadPlugin(plugin1);
    await fixture.core.loadPlugin(plugin2);

    const pluginEvents = fixture.events.filter(
      (e) => e.type === AgentEventType.PLUGIN_LOADED,
    );
    expect(pluginEvents).toHaveLength(2);
    expect(pluginEvents[0].payload).toMatchObject({ name: "plugin-1" });
    expect(pluginEvents[1].payload).toMatchObject({ name: "plugin-2" });
  });

  it("should call plugin factory with context", async () => {
    let receivedContext: IPluginContext | null = null;

    const plugin: IPlugin = {
      manifest: { name: "context-test", version: "0.1.0", description: "Test", sandbox: { enabled: false } },
      async factory(ctx: IPluginContext): Promise<PluginHooks> {
        receivedContext = ctx;
        return {};
      },
    };

    await fixture.core.loadPlugin(plugin);

    expect(receivedContext).not.toBeNull();
    expect(receivedContext?.agentId).toBe("test-agent");
    expect(receivedContext?.bus).toBeDefined();
    expect(receivedContext?.pushInput).toBeDefined();
    expect(receivedContext?.sessions).toBeDefined();
  });

  it("should register plugin hooks correctly", async () => {
    const mockListener = {
      id: "mock-listener",
      name: "Mock Listener",
    };

    const plugin: IPlugin = {
      manifest: { name: "hooks-test", version: "0.1.0", description: "Test", sandbox: { enabled: false } },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        return {
          listeners: [mockListener],
        };
      },
    };

    await fixture.core.loadPlugin(plugin);

    const registeredListeners = fixture.core.listenerRegistry.list();
    expect(registeredListeners).toContainEqual(mockListener);
  });

  it("should start listeners when agent starts", async () => {
    let listenerStarted = false;

    const mockListener = {
      id: "start-test-listener",
      name: "Start Test Listener",
      async start() {
        listenerStarted = true;
      },
    };

    const plugin: IPlugin = {
      manifest: { name: "start-test", version: "0.1.0", description: "Test", sandbox: { enabled: false } },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        return {
          listeners: [mockListener],
        };
      },
    };

    await fixture.core.loadPlugin(plugin);
    await fixture.start();

    expect(listenerStarted).toBe(true);
  });

  it("should stop listeners when agent stops", async () => {
    let listenerStopped = false;

    const mockListener = {
      id: "stop-test-listener",
      name: "Stop Test Listener",
      async stop() {
        listenerStopped = true;
      },
    };

    const plugin: IPlugin = {
      manifest: { name: "stop-test", version: "0.1.0", description: "Test", sandbox: { enabled: false } },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        return {
          listeners: [mockListener],
        };
      },
    };

    await fixture.core.loadPlugin(plugin);
    await fixture.start();
    await fixture.stop();

    expect(listenerStopped).toBe(true);
  });

  it("should handle plugin with no hooks", async () => {
    const plugin: IPlugin = {
      manifest: { name: "empty-plugin", version: "0.1.0", description: "Empty", sandbox: { enabled: false } },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        return {};
      },
    };

    await expect(fixture.core.loadPlugin(plugin)).resolves.not.toThrow();

    const pluginLoadedEvent = fixture.events.find(
      (e) => e.type === AgentEventType.PLUGIN_LOADED,
    );
    expect(pluginLoadedEvent).toBeDefined();
  });

  it("should handle multiple UI plugins coexisting", async () => {
    const mockUI1 = {
      id: "ui-1",
      name: "UI 1",
    };

    const mockUI2 = {
      id: "ui-2",
      name: "UI 2",
    };

    const plugin1: IPlugin = {
      manifest: { name: "ui-plugin-1", version: "0.1.0", description: "UI 1", sandbox: { enabled: false } },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        return { ui: [mockUI1] };
      },
    };

    const plugin2: IPlugin = {
      manifest: { name: "ui-plugin-2", version: "0.1.0", description: "UI 2", sandbox: { enabled: false } },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        return { ui: [mockUI2] };
      },
    };

    await fixture.core.loadPlugin(plugin1);
    await fixture.core.loadPlugin(plugin2);

    const registeredUIs = fixture.core.uiRegistry.list();
    expect(registeredUIs).toHaveLength(2);
    expect(registeredUIs).toContainEqual(mockUI1);
    expect(registeredUIs).toContainEqual(mockUI2);
  });
});
