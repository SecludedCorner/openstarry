import { describe, it, expect, vi } from "vitest";
import type { IProvider, IAgentConfig, PluginManifest } from "@openstarry/sdk";
import { createAgentCore } from "../agent-core.js";

describe("Plugin Context Provider Access Control", () => {
  const createMockConfig = (): IAgentConfig => ({
    identity: { id: "test-agent", name: "Test Agent" },
    plugins: [],
    cognition: {
      provider: "test-provider",
      model: "test-model",
    },
    capabilities: {},
  });

  const createMockProvider = (id: string, name: string): IProvider => ({
    id,
    name,
    models: [{ id: `${id}-model`, name: `${name} Model` }],
    chat: vi.fn(),
  });

  it("plugin with allowedProviders only sees allowed providers in list()", async () => {
    const core = createAgentCore(createMockConfig());

    const openaiProvider = createMockProvider("openai", "OpenAI");
    const anthropicProvider = createMockProvider("anthropic", "Anthropic");
    const localProvider = createMockProvider("local", "Local");

    core.providerRegistry.register(openaiProvider);
    core.providerRegistry.register(anthropicProvider);
    core.providerRegistry.register(localProvider);

    const manifest: PluginManifest = {
      name: "restricted-plugin",
      version: "1.0.0",
      description: "Test plugin with provider restrictions",
      capabilities: {
        allowedProviders: ["openai"],
      },
      sandbox: {
        enabled: false,
      },
    };

    let capturedContext;
    const plugin = {
      manifest,
      factory: (ctx) => {
        capturedContext = ctx;
        return {};
      },
    };

    await core.loadPlugin(plugin);

    const visibleProviders = capturedContext.providers.list();
    expect(visibleProviders).toHaveLength(1);
    expect(visibleProviders[0].id).toBe("openai");
    expect(visibleProviders.some(p => p.id === "anthropic")).toBe(false);
    expect(visibleProviders.some(p => p.id === "local")).toBe(false);
  });

  it("get() returns undefined if provider is blocked by allowedProviders", async () => {
    const core = createAgentCore(createMockConfig());

    const openaiProvider = createMockProvider("openai", "OpenAI");
    const anthropicProvider = createMockProvider("anthropic", "Anthropic");

    core.providerRegistry.register(openaiProvider);
    core.providerRegistry.register(anthropicProvider);

    const manifest: PluginManifest = {
      name: "restricted-plugin",
      version: "1.0.0",
      description: "Test plugin with provider restrictions",
      capabilities: {
        allowedProviders: ["openai"],
      },
      sandbox: {
        enabled: false,
      },
    };

    let capturedContext;
    const plugin = {
      manifest,
      factory: (ctx) => {
        capturedContext = ctx;
        return {};
      },
    };

    await core.loadPlugin(plugin);

    const allowedProvider = capturedContext.providers.get("openai");
    expect(allowedProvider).toBeDefined();
    expect(allowedProvider?.id).toBe("openai");

    const blockedProvider = capturedContext.providers.get("anthropic");
    expect(blockedProvider).toBeUndefined();
  });

  it("plugin with no capabilities sees all providers", async () => {
    const core = createAgentCore(createMockConfig());

    const openaiProvider = createMockProvider("openai", "OpenAI");
    const anthropicProvider = createMockProvider("anthropic", "Anthropic");
    const localProvider = createMockProvider("local", "Local");

    core.providerRegistry.register(openaiProvider);
    core.providerRegistry.register(anthropicProvider);
    core.providerRegistry.register(localProvider);

    const manifest: PluginManifest = {
      name: "unrestricted-plugin",
      version: "1.0.0",
      description: "Test plugin without capabilities",
      sandbox: {
        enabled: false,
      },
    };

    let capturedContext;
    const plugin = {
      manifest,
      factory: (ctx) => {
        capturedContext = ctx;
        return {};
      },
    };

    await core.loadPlugin(plugin);

    const visibleProviders = capturedContext.providers.list();
    expect(visibleProviders).toHaveLength(3);
    expect(visibleProviders.some(p => p.id === "openai")).toBe(true);
    expect(visibleProviders.some(p => p.id === "anthropic")).toBe(true);
    expect(visibleProviders.some(p => p.id === "local")).toBe(true);

    expect(capturedContext.providers.get("openai")).toBeDefined();
    expect(capturedContext.providers.get("anthropic")).toBeDefined();
    expect(capturedContext.providers.get("local")).toBeDefined();
  });

  it("plugin with empty allowedProviders array sees all providers", async () => {
    const core = createAgentCore(createMockConfig());

    const openaiProvider = createMockProvider("openai", "OpenAI");
    const anthropicProvider = createMockProvider("anthropic", "Anthropic");

    core.providerRegistry.register(openaiProvider);
    core.providerRegistry.register(anthropicProvider);

    const manifest: PluginManifest = {
      name: "no-filter-plugin",
      version: "1.0.0",
      description: "Test plugin with empty allowedProviders (no filtering)",
      capabilities: {
        allowedProviders: [],
      },
      sandbox: {
        enabled: false,
      },
    };

    let capturedContext;
    const plugin = {
      manifest,
      factory: (ctx) => {
        capturedContext = ctx;
        return {};
      },
    };

    await core.loadPlugin(plugin);

    const visibleProviders = capturedContext.providers.list();
    expect(visibleProviders).toHaveLength(2);
    expect(visibleProviders.some(p => p.id === "openai")).toBe(true);
    expect(visibleProviders.some(p => p.id === "anthropic")).toBe(true);

    expect(capturedContext.providers.get("openai")).toBeDefined();
    expect(capturedContext.providers.get("anthropic")).toBeDefined();
  });
});
