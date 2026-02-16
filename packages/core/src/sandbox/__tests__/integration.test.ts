import { describe, it, expect, vi } from "vitest";
import type {
  IPlugin,
  IPluginContext,
  PluginHooks,
  EventBus,
  AgentEvent,
  InputEvent,
  ISessionManager,
  ISession,
  ITool,
  IGuide,
  SandboxConfig,
} from "@openstarry/sdk";
import { SandboxError } from "@openstarry/sdk";
import {
  createPluginLoader,
  createToolRegistry,
  createProviderRegistry,
  createListenerRegistry,
  createUIRegistry,
  createGuideRegistry,
  createCommandRegistry,
} from "../../infrastructure/index.js";
import type { PluginSandboxManager } from "../sandbox-manager.js";

function createMockBus(): EventBus {
  return {
    on: vi.fn(() => () => {}),
    once: vi.fn(() => () => {}),
    onAny: vi.fn(() => () => {}),
    emit: vi.fn(),
  };
}

function createMockSession(): ISession {
  return {
    id: "test-session",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {},
  };
}

function createMockCtx(): IPluginContext {
  const session = createMockSession();
  return {
    bus: createMockBus(),
    workingDirectory: "/tmp/test",
    agentId: "test-agent",
    config: {},
    pushInput: vi.fn(),
    sessions: {
      create: vi.fn(() => session),
      get: vi.fn(() => session),
      list: vi.fn(() => [session]),
      destroy: vi.fn(() => true),
      getStateManager: vi.fn(() => ({
        getMessages: () => [],
        addMessage: () => {},
        clear: () => {},
        snapshot: () => [],
        restore: () => {},
      })),
      getDefaultSession: vi.fn(() => session),
    },
  };
}

function createMockSandboxManager(
  overrides?: Partial<PluginSandboxManager>,
): PluginSandboxManager {
  return {
    loadInSandbox: vi.fn(async (_plugin: IPlugin, _ctx: IPluginContext): Promise<PluginHooks> => ({
      tools: [],
    })),
    invokeTool: vi.fn(async () => "mocked result"),
    shutdownPlugin: vi.fn(async () => {}),
    shutdownAll: vi.fn(async () => {}),
    getResourceUsage: vi.fn(async () => null),
    ...overrides,
  };
}

describe("Plugin Loader + Sandbox Integration", () => {
  it("uses sandbox when plugin has sandbox.enabled: true", async () => {
    const sandboxManager = createMockSandboxManager();
    const loader = createPluginLoader({
      toolRegistry: createToolRegistry(),
      providerRegistry: createProviderRegistry(),
      listenerRegistry: createListenerRegistry(),
      uiRegistry: createUIRegistry(),
      guideRegistry: createGuideRegistry(),
      commandRegistry: createCommandRegistry(),
      sandboxManager,
    });

    const plugin: IPlugin = {
      manifest: {
        name: "sandbox-test",
        version: "1.0.0",
        sandbox: { enabled: true },
      },
      factory: vi.fn(async () => ({})),
    };

    const ctx = createMockCtx();
    await loader.load(plugin, ctx);

    expect(sandboxManager.loadInSandbox).toHaveBeenCalledWith(plugin, ctx);
    expect(plugin.factory).not.toHaveBeenCalled(); // Factory not called directly
  });

  it("uses in-process loading by default when sandbox config is undefined (opt-in)", async () => {
    const sandboxManager = createMockSandboxManager();
    const loader = createPluginLoader({
      toolRegistry: createToolRegistry(),
      providerRegistry: createProviderRegistry(),
      listenerRegistry: createListenerRegistry(),
      uiRegistry: createUIRegistry(),
      guideRegistry: createGuideRegistry(),
      commandRegistry: createCommandRegistry(),
      sandboxManager,
    });

    const plugin: IPlugin = {
      manifest: {
        name: "default-sandbox",
        version: "1.0.0",
        // No sandbox config → defaults to disabled (opt-in)
      },
      factory: vi.fn(async () => ({})),
    };

    const ctx = createMockCtx();
    await loader.load(plugin, ctx);

    expect(sandboxManager.loadInSandbox).not.toHaveBeenCalled();
    expect(plugin.factory).toHaveBeenCalledWith(ctx);
  });

  it("uses legacy in-process loading when sandbox.enabled: false", async () => {
    const sandboxManager = createMockSandboxManager();
    const loader = createPluginLoader({
      toolRegistry: createToolRegistry(),
      providerRegistry: createProviderRegistry(),
      listenerRegistry: createListenerRegistry(),
      uiRegistry: createUIRegistry(),
      guideRegistry: createGuideRegistry(),
      commandRegistry: createCommandRegistry(),
      sandboxManager,
    });

    const plugin: IPlugin = {
      manifest: {
        name: "legacy-plugin",
        version: "1.0.0",
        sandbox: { enabled: false },
      },
      factory: vi.fn(async () => ({})),
    };

    const ctx = createMockCtx();
    await loader.load(plugin, ctx);

    expect(sandboxManager.loadInSandbox).not.toHaveBeenCalled();
    expect(plugin.factory).toHaveBeenCalledWith(ctx);
  });

  it("uses legacy loading when no sandboxManager is provided", async () => {
    const loader = createPluginLoader({
      toolRegistry: createToolRegistry(),
      providerRegistry: createProviderRegistry(),
      listenerRegistry: createListenerRegistry(),
      uiRegistry: createUIRegistry(),
      guideRegistry: createGuideRegistry(),
      commandRegistry: createCommandRegistry(),
      // No sandboxManager
    });

    const plugin: IPlugin = {
      manifest: { name: "no-sandbox", version: "1.0.0" },
      factory: vi.fn(async () => ({})),
    };

    const ctx = createMockCtx();
    await loader.load(plugin, ctx);

    expect(plugin.factory).toHaveBeenCalledWith(ctx);
  });

  it("registers tools from sandboxed plugins into ToolRegistry", async () => {
    const toolRegistry = createToolRegistry();
    const { z } = await import("zod");

    const mockTool: ITool = {
      id: "sandboxed-tool",
      description: "A tool from sandboxed plugin",
      parameters: z.object({ input: z.string() }),
      execute: vi.fn(async () => "result"),
    };

    const sandboxManager = createMockSandboxManager({
      loadInSandbox: vi.fn(async () => ({
        tools: [mockTool],
      })),
    });

    const loader = createPluginLoader({
      toolRegistry,
      providerRegistry: createProviderRegistry(),
      listenerRegistry: createListenerRegistry(),
      uiRegistry: createUIRegistry(),
      guideRegistry: createGuideRegistry(),
      commandRegistry: createCommandRegistry(),
      sandboxManager,
    });

    const plugin: IPlugin = {
      manifest: { name: "tool-plugin", version: "1.0.0", sandbox: { enabled: true } },
      factory: async () => ({}),
    };

    await loader.load(plugin, createMockCtx());

    const registered = toolRegistry.get("sandboxed-tool");
    expect(registered).toBeDefined();
    expect(registered!.id).toBe("sandboxed-tool");
  });

  it("wraps sandbox errors as PluginLoadError", async () => {
    const sandboxManager = createMockSandboxManager({
      loadInSandbox: vi.fn(async () => {
        throw new SandboxError("broken-plugin", "Worker failed to start");
      }),
    });

    const loader = createPluginLoader({
      toolRegistry: createToolRegistry(),
      providerRegistry: createProviderRegistry(),
      listenerRegistry: createListenerRegistry(),
      uiRegistry: createUIRegistry(),
      guideRegistry: createGuideRegistry(),
      commandRegistry: createCommandRegistry(),
      sandboxManager,
    });

    const plugin: IPlugin = {
      manifest: { name: "broken-plugin", version: "1.0.0", sandbox: { enabled: true } },
      factory: async () => ({}),
    };

    await expect(loader.load(plugin, createMockCtx())).rejects.toThrow(/Worker failed to start/);
  });

  it("disposeAll shuts down sandbox manager", async () => {
    const sandboxManager = createMockSandboxManager();
    const loader = createPluginLoader({
      toolRegistry: createToolRegistry(),
      providerRegistry: createProviderRegistry(),
      listenerRegistry: createListenerRegistry(),
      uiRegistry: createUIRegistry(),
      guideRegistry: createGuideRegistry(),
      commandRegistry: createCommandRegistry(),
      sandboxManager,
    });

    await loader.disposeAll();
    expect(sandboxManager.shutdownAll).toHaveBeenCalled();
  });

  it("SandboxConfig interface matches Architecture Spec", () => {
    const config: SandboxConfig = {
      enabled: true,
      memoryLimitMb: 256,
      allowedPaths: ["/tmp"],
      allowedDomains: ["api.example.com"],
    };

    expect(config.enabled).toBe(true);
    expect(config.memoryLimitMb).toBe(256);
    expect(config.allowedPaths).toEqual(["/tmp"]);
    expect(config.allowedDomains).toEqual(["api.example.com"]);
  });

  it("SandboxError includes plugin name and code", () => {
    const err = new SandboxError("test-plugin", "Worker crashed", { code: "SANDBOX_CRASH" });
    expect(err.pluginName).toBe("test-plugin");
    expect(err.code).toBe("SANDBOX_CRASH");
    expect(err.name).toBe("SandboxError");
    expect(err.message).toContain("test-plugin");
    expect(err.message).toContain("Worker crashed");
  });
});
