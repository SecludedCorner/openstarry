/**
 * E2E Tests: Multi-Plugin Interaction
 * Tests plugin coexistence, interaction via EventBus, and load order.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAgentFixture, type IAgentTestFixture } from "./helpers/index.js";
import {
  AgentEventType,
  type IPlugin,
  type IPluginContext,
  type PluginHooks,
  type IProvider,
  type ChatRequest,
  type ProviderStreamEvent,
} from "@openstarry/sdk";

describe("E2E: Multi-Plugin Interaction", () => {
  let fixture: IAgentTestFixture;

  beforeEach(() => {
    fixture = createAgentFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("should load provider and listener plugins together", async () => {
    const mockProvider: IProvider = {
      id: "test-provider",
      name: "Test Provider",
      models: [{ id: "test-model", name: "Test Model" }],
      async *chat(_request: ChatRequest): AsyncIterable<ProviderStreamEvent> {
        yield { type: "text_delta", text: "Test" };
        yield { type: "finish", stopReason: "end_turn" };
      },
    };

    const mockListener = {
      id: "test-listener",
      name: "Test Listener",
    };

    const providerPlugin: IPlugin = {
      manifest: { name: "provider-plugin", version: "0.1.0", description: "Provider", sandbox: { enabled: false } },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        return { providers: [mockProvider] };
      },
    };

    const listenerPlugin: IPlugin = {
      manifest: { name: "listener-plugin", version: "0.1.0", description: "Listener" , sandbox: { enabled: false } },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        return { listeners: [mockListener] };
      },
    };

    await fixture.core.loadPlugin(providerPlugin);
    await fixture.core.loadPlugin(listenerPlugin);

    const providers = fixture.core.providerRegistry.list();
    const listeners = fixture.core.listenerRegistry.list();

    expect(providers).toContainEqual(mockProvider);
    expect(listeners).toContainEqual(mockListener);
  });

  it("should allow provider and UI plugins to coexist", async () => {
    const mockProvider: IProvider = {
      id: "ui-test-provider",
      name: "UI Test Provider",
      models: [{ id: "ui-model", name: "UI Model" }],
      async *chat(_request: ChatRequest): AsyncIterable<ProviderStreamEvent> {
        yield { type: "text_delta", text: "UI Test" };
        yield { type: "finish", stopReason: "end_turn" };
      },
    };

    const mockUI = {
      id: "test-ui",
      name: "Test UI",
    };

    const providerPlugin: IPlugin = {
      manifest: { name: "ui-provider-plugin", version: "0.1.0", description: "Provider" , sandbox: { enabled: false } },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        return { providers: [mockProvider] };
      },
    };

    const uiPlugin: IPlugin = {
      manifest: { name: "ui-ui-plugin", version: "0.1.0", description: "UI" , sandbox: { enabled: false } },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        return { ui: [mockUI] };
      },
    };

    await fixture.core.loadPlugin(providerPlugin);
    await fixture.core.loadPlugin(uiPlugin);

    const providers = fixture.core.providerRegistry.list();
    const uis = fixture.core.uiRegistry.list();

    expect(providers).toContainEqual(mockProvider);
    expect(uis).toContainEqual(mockUI);
  });

  it("should allow multiple listeners to receive same events", async () => {
    const events1: string[] = [];
    const events2: string[] = [];

    const listener1 = {
      id: "listener-1",
      name: "Listener 1",
    };

    const listener2 = {
      id: "listener-2",
      name: "Listener 2",
    };

    const plugin1: IPlugin = {
      manifest: { name: "multi-listener-1", version: "0.1.0", description: "L1" , sandbox: { enabled: false } },
      async factory(ctx: IPluginContext): Promise<PluginHooks> {
        ctx.bus.on(AgentEventType.AGENT_STARTED, () => {
          events1.push("started");
        });
        return { listeners: [listener1] };
      },
    };

    const plugin2: IPlugin = {
      manifest: { name: "multi-listener-2", version: "0.1.0", description: "L2" , sandbox: { enabled: false } },
      async factory(ctx: IPluginContext): Promise<PluginHooks> {
        ctx.bus.on(AgentEventType.AGENT_STARTED, () => {
          events2.push("started");
        });
        return { listeners: [listener2] };
      },
    };

    await fixture.core.loadPlugin(plugin1);
    await fixture.core.loadPlugin(plugin2);
    await fixture.start();

    expect(events1).toContain("started");
    expect(events2).toContain("started");
  });

  it("should support plugin interaction via EventBus", async () => {
    let receivedMessage = "";

    const senderPlugin: IPlugin = {
      manifest: { name: "sender", version: "0.1.0", description: "Sender" , sandbox: { enabled: false } },
      async factory(ctx: IPluginContext): Promise<PluginHooks> {
        setTimeout(() => {
          ctx.bus.emit({
            type: "custom:test_event",
            timestamp: Date.now(),
            payload: { message: "Hello from sender" },
          });
        }, 100);
        return {};
      },
    };

    const receiverPlugin: IPlugin = {
      manifest: { name: "receiver", version: "0.1.0", description: "Receiver" , sandbox: { enabled: false } },
      async factory(ctx: IPluginContext): Promise<PluginHooks> {
        ctx.bus.on("custom:test_event", (event) => {
          receivedMessage = (event.payload as any)?.message || "";
        });
        return {};
      },
    };

    await fixture.core.loadPlugin(receiverPlugin);
    await fixture.core.loadPlugin(senderPlugin);

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(receivedMessage).toBe("Hello from sender");
  });

  it("should preserve plugin load order", async () => {
    const loadOrder: string[] = [];

    const plugin1: IPlugin = {
      manifest: { name: "order-1", version: "0.1.0", description: "First" , sandbox: { enabled: false } },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        loadOrder.push("order-1");
        return {};
      },
    };

    const plugin2: IPlugin = {
      manifest: { name: "order-2", version: "0.1.0", description: "Second" , sandbox: { enabled: false } },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        loadOrder.push("order-2");
        return {};
      },
    };

    const plugin3: IPlugin = {
      manifest: { name: "order-3", version: "0.1.0", description: "Third" , sandbox: { enabled: false } },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        loadOrder.push("order-3");
        return {};
      },
    };

    await fixture.core.loadPlugin(plugin1);
    await fixture.core.loadPlugin(plugin2);
    await fixture.core.loadPlugin(plugin3);

    expect(loadOrder).toEqual(["order-1", "order-2", "order-3"]);
  });

  it("should isolate plugin errors from other plugins", async () => {
    const healthyPlugin: IPlugin = {
      manifest: { name: "healthy", version: "0.1.0", description: "Healthy" , sandbox: { enabled: false } },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        return {
          listeners: [{ id: "healthy-listener", name: "Healthy Listener" }],
        };
      },
    };

    const faultyPlugin: IPlugin = {
      manifest: { name: "faulty", version: "0.1.0", description: "Faulty" , sandbox: { enabled: false } },
      async factory(_ctx: IPluginContext): Promise<PluginHooks> {
        throw new Error("Plugin factory error");
      },
    };

    await fixture.core.loadPlugin(healthyPlugin);

    await expect(fixture.core.loadPlugin(faultyPlugin)).rejects.toThrow();

    const listeners = fixture.core.listenerRegistry.list();
    expect(listeners).toHaveLength(1);
    expect(listeners[0].id).toBe("healthy-listener");
  });
});
