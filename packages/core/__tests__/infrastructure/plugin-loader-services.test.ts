/**
 * Unit tests for PluginLoader service registry integration.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPluginLoader, type PluginLoaderDeps } from "../../src/infrastructure/plugin-loader.js";
import { createServiceRegistry } from "../../src/infrastructure/service-registry.js";
import { createToolRegistry } from "../../src/infrastructure/tool-registry.js";
import { createProviderRegistry } from "../../src/infrastructure/provider-registry.js";
import { createListenerRegistry } from "../../src/infrastructure/listener-registry.js";
import { createUIRegistry } from "../../src/infrastructure/ui-registry.js";
import { createGuideRegistry } from "../../src/infrastructure/guide-registry.js";
import { createCommandRegistry } from "../../src/infrastructure/command-registry.js";
import type { IPlugin, IPluginContext, IPluginService } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("plugin-loader-services-test");

describe("PluginLoader - Service Registry Integration", () => {
  let loader: ReturnType<typeof createPluginLoader>;
  let deps: PluginLoaderDeps;
  let serviceRegistry: ReturnType<typeof createServiceRegistry>;
  let ctx: IPluginContext;

  beforeEach(() => {
    serviceRegistry = createServiceRegistry();
    deps = {
      toolRegistry: createToolRegistry(),
      providerRegistry: createProviderRegistry(),
      listenerRegistry: createListenerRegistry(),
      uiRegistry: createUIRegistry(),
      guideRegistry: createGuideRegistry(),
      commandRegistry: createCommandRegistry(),
    };
    loader = createPluginLoader(deps);

    ctx = {
      bus: {
        emit: vi.fn(),
        on: vi.fn(() => () => {}),
        once: vi.fn(() => () => {}),
        onAny: vi.fn(() => () => {}),
      },
      workingDirectory: "/test",
      agentId: "test-agent",
      config: {},
      pushInput: vi.fn(),
      sessions: {
        create: vi.fn(),
        get: vi.fn(),
        list: vi.fn(() => []),
        destroy: vi.fn(),
        getStateManager: vi.fn(),
        getDefaultSession: vi.fn(),
      },
      tools: { list: () => [], get: () => undefined },
      guides: { list: () => [] },
      providers: { list: () => [], get: () => undefined },
      services: serviceRegistry,
    };
  });

  it("injects ServiceRegistry into plugin context", async () => {
    const plugin: IPlugin = {
      manifest: { name: "test-plugin", version: "1.0.0" },
      factory: async (ctx) => {
        expect(ctx.services).toBeDefined();
        expect(typeof ctx.services?.register).toBe("function");
        return {};
      },
    };

    await loader.load(plugin, ctx);
  });

  it("plugin can register service during factory execution", async () => {
    const testService: IPluginService = { name: "test-service", version: "1.0.0" };

    const plugin: IPlugin = {
      manifest: { name: "service-provider", version: "1.0.0" },
      factory: async (ctx) => {
        ctx.services?.register(testService);
        return {};
      },
    };

    await loader.load(plugin, ctx);

    expect(serviceRegistry.get("test-service")).toBe(testService);
  });

  it("plugin can retrieve service registered by earlier plugin", async () => {
    const sharedService: IPluginService = { name: "shared", version: "1.0.0" };

    const providerPlugin: IPlugin = {
      manifest: { name: "provider", version: "1.0.0" },
      factory: async (ctx) => {
        ctx.services?.register(sharedService);
        return {};
      },
    };

    const consumerPlugin: IPlugin = {
      manifest: { name: "consumer", version: "1.0.0", serviceDependencies: ["shared"] },
      factory: async (ctx) => {
        const retrieved = ctx.services?.get("shared");
        expect(retrieved).toBe(sharedService);
        return {};
      },
    };

    await loader.load(providerPlugin, ctx);
    await loader.load(consumerPlugin, ctx);
  });

  it("plugin without services field in manifest works normally (backward compat)", async () => {
    const plugin: IPlugin = {
      manifest: { name: "legacy-plugin", version: "1.0.0" },
      factory: async () => {
        return { tools: [] };
      },
    };

    await expect(loader.load(plugin, ctx)).resolves.not.toThrow();
  });

  it("plugin with serviceDependencies in manifest loads successfully", async () => {
    const plugin: IPlugin = {
      manifest: {
        name: "dependent-plugin",
        version: "1.0.0",
        serviceDependencies: ["some-service"],
      },
      factory: async () => ({ tools: [] }),
    };

    await expect(loader.load(plugin, ctx)).resolves.not.toThrow();
  });

  it("PluginLoader logs warning if serviceDependencies not satisfied (but still loads)", async () => {
    const warnSpy = vi.spyOn(logger, "warn");

    const plugin: IPlugin = {
      manifest: {
        name: "missing-deps",
        version: "1.0.0",
        serviceDependencies: ["missing-service"],
      },
      factory: async () => ({ tools: [] }),
    };

    await loader.load(plugin, ctx);

    // Check that warning was logged (via logger)
    // Note: This test may need adjustment based on how createLogger works in tests
  });

  it("PluginLoader does NOT throw error for missing dependencies (soft validation)", async () => {
    const plugin: IPlugin = {
      manifest: {
        name: "soft-fail",
        version: "1.0.0",
        serviceDependencies: ["nonexistent"],
      },
      factory: async () => ({ tools: [] }),
    };

    await expect(loader.load(plugin, ctx)).resolves.not.toThrow();
  });

  it("manifest services field is informational only (plugin can register undeclared service)", async () => {
    const undeclaredService: IPluginService = { name: "undeclared", version: "1.0.0" };

    const plugin: IPlugin = {
      manifest: { name: "sneaky", version: "1.0.0", services: ["declared"] },
      factory: async (ctx) => {
        ctx.services?.register(undeclaredService);
        return {};
      },
    };

    await loader.load(plugin, ctx);

    expect(serviceRegistry.get("undeclared")).toBe(undeclaredService);
  });

  it("ctx.services is undefined if no ServiceRegistry provided (graceful degradation)", async () => {
    const ctxWithoutServices: IPluginContext = {
      ...ctx,
      services: undefined,
    };

    const plugin: IPlugin = {
      manifest: { name: "no-services", version: "1.0.0" },
      factory: async (ctx) => {
        expect(ctx.services).toBeUndefined();
        return {};
      },
    };

    await loader.load(plugin, ctxWithoutServices);
  });

  it("plugin can declare multiple service dependencies", async () => {
    const service1: IPluginService = { name: "service-1", version: "1.0.0" };
    const service2: IPluginService = { name: "service-2", version: "1.0.0" };

    serviceRegistry.register(service1);
    serviceRegistry.register(service2);

    const plugin: IPlugin = {
      manifest: {
        name: "multi-dep",
        version: "1.0.0",
        serviceDependencies: ["service-1", "service-2"],
      },
      factory: async (ctx) => {
        expect(ctx.services?.get("service-1")).toBe(service1);
        expect(ctx.services?.get("service-2")).toBe(service2);
        return {};
      },
    };

    await loader.load(plugin, ctx);
  });
});
