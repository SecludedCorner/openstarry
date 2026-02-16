/**
 * Unit tests for PluginLoader topological sort and loadAll.
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
import { PluginLoadError } from "@openstarry/sdk";

describe("PluginLoader - Topological Sort", () => {
  let loader: ReturnType<typeof createPluginLoader>;
  let deps: PluginLoaderDeps;
  let serviceRegistry: ReturnType<typeof createServiceRegistry>;

  function createMockContext(): IPluginContext {
    return {
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
  }

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
  });

  describe("topologicalSort", () => {
    it("sorts two plugins with single dependency", async () => {
      const loadOrder: string[] = [];

      const pluginA: IPlugin = {
        manifest: { name: "provider", version: "1.0.0", services: ["service-a"] },
        factory: async (ctx) => {
          loadOrder.push("provider");
          ctx.services?.register({ name: "service-a", version: "1.0.0" });
          return {};
        },
      };

      const pluginB: IPlugin = {
        manifest: { name: "consumer", version: "1.0.0", serviceDependencies: ["service-a"] },
        factory: async (ctx) => {
          loadOrder.push("consumer");
          expect(ctx.services?.get("service-a")).toBeDefined();
          return {};
        },
      };

      await loader.loadAll([pluginB, pluginA], createMockContext);

      expect(loadOrder).toEqual(["provider", "consumer"]);
    });

    it("sorts three plugins with chain dependency", async () => {
      const loadOrder: string[] = [];

      const pluginA: IPlugin = {
        manifest: { name: "a", version: "1.0.0", services: ["service-a"] },
        factory: async (ctx) => {
          loadOrder.push("a");
          ctx.services?.register({ name: "service-a", version: "1.0.0" });
          return {};
        },
      };

      const pluginB: IPlugin = {
        manifest: {
          name: "b",
          version: "1.0.0",
          services: ["service-b"],
          serviceDependencies: ["service-a"],
        },
        factory: async (ctx) => {
          loadOrder.push("b");
          ctx.services?.register({ name: "service-b", version: "1.0.0" });
          return {};
        },
      };

      const pluginC: IPlugin = {
        manifest: { name: "c", version: "1.0.0", serviceDependencies: ["service-b"] },
        factory: async (ctx) => {
          loadOrder.push("c");
          return {};
        },
      };

      await loader.loadAll([pluginC, pluginB, pluginA], createMockContext);

      expect(loadOrder).toEqual(["a", "b", "c"]);
    });

    it("preserves config order for independent plugins", async () => {
      const loadOrder: string[] = [];

      const pluginA: IPlugin = {
        manifest: { name: "a", version: "1.0.0" },
        factory: async () => {
          loadOrder.push("a");
          return {};
        },
      };

      const pluginB: IPlugin = {
        manifest: { name: "b", version: "1.0.0" },
        factory: async () => {
          loadOrder.push("b");
          return {};
        },
      };

      const pluginC: IPlugin = {
        manifest: { name: "c", version: "1.0.0" },
        factory: async () => {
          loadOrder.push("c");
          return {};
        },
      };

      await loader.loadAll([pluginA, pluginB, pluginC], createMockContext);

      expect(loadOrder).toEqual(["a", "b", "c"]);
    });

    it("handles plugins with no serviceDependencies", async () => {
      const loadOrder: string[] = [];

      const plugin: IPlugin = {
        manifest: { name: "simple", version: "1.0.0" },
        factory: async () => {
          loadOrder.push("simple");
          return {};
        },
      };

      await loader.loadAll([plugin], createMockContext);

      expect(loadOrder).toEqual(["simple"]);
    });

    it("detects two-node cycle", async () => {
      const pluginA: IPlugin = {
        manifest: {
          name: "a",
          version: "1.0.0",
          services: ["service-a"],
          serviceDependencies: ["service-b"],
        },
        factory: async () => ({}),
      };

      const pluginB: IPlugin = {
        manifest: {
          name: "b",
          version: "1.0.0",
          services: ["service-b"],
          serviceDependencies: ["service-a"],
        },
        factory: async () => ({}),
      };

      await expect(loader.loadAll([pluginA, pluginB], createMockContext)).rejects.toThrow(
        PluginLoadError
      );
    });

    it("detects three-node cycle", async () => {
      const pluginA: IPlugin = {
        manifest: {
          name: "a",
          version: "1.0.0",
          services: ["service-a"],
          serviceDependencies: ["service-c"],
        },
        factory: async () => ({}),
      };

      const pluginB: IPlugin = {
        manifest: {
          name: "b",
          version: "1.0.0",
          services: ["service-b"],
          serviceDependencies: ["service-a"],
        },
        factory: async () => ({}),
      };

      const pluginC: IPlugin = {
        manifest: {
          name: "c",
          version: "1.0.0",
          services: ["service-c"],
          serviceDependencies: ["service-b"],
        },
        factory: async () => ({}),
      };

      await expect(loader.loadAll([pluginA, pluginB, pluginC], createMockContext)).rejects.toThrow(
        PluginLoadError
      );
    });

    it("throws PluginLoadError with cycle details", async () => {
      const pluginA: IPlugin = {
        manifest: {
          name: "cyclic-a",
          version: "1.0.0",
          services: ["service-a"],
          serviceDependencies: ["service-b"],
        },
        factory: async () => ({}),
      };

      const pluginB: IPlugin = {
        manifest: {
          name: "cyclic-b",
          version: "1.0.0",
          services: ["service-b"],
          serviceDependencies: ["service-a"],
        },
        factory: async () => ({}),
      };

      await expect(loader.loadAll([pluginA, pluginB], createMockContext)).rejects.toThrow(
        /Circular dependency detected/
      );
    });

    it("handles diamond dependency", async () => {
      const loadOrder: string[] = [];

      const pluginA: IPlugin = {
        manifest: { name: "a", version: "1.0.0", services: ["service-a"] },
        factory: async (ctx) => {
          loadOrder.push("a");
          ctx.services?.register({ name: "service-a", version: "1.0.0" });
          return {};
        },
      };

      const pluginB: IPlugin = {
        manifest: {
          name: "b",
          version: "1.0.0",
          services: ["service-b"],
          serviceDependencies: ["service-a"],
        },
        factory: async (ctx) => {
          loadOrder.push("b");
          ctx.services?.register({ name: "service-b", version: "1.0.0" });
          return {};
        },
      };

      const pluginC: IPlugin = {
        manifest: {
          name: "c",
          version: "1.0.0",
          services: ["service-c"],
          serviceDependencies: ["service-a"],
        },
        factory: async (ctx) => {
          loadOrder.push("c");
          ctx.services?.register({ name: "service-c", version: "1.0.0" });
          return {};
        },
      };

      const pluginD: IPlugin = {
        manifest: {
          name: "d",
          version: "1.0.0",
          serviceDependencies: ["service-b", "service-c"],
        },
        factory: async () => {
          loadOrder.push("d");
          return {};
        },
      };

      await loader.loadAll([pluginD, pluginC, pluginB, pluginA], createMockContext);

      // A must come first, B and C must come before D
      expect(loadOrder[0]).toBe("a");
      expect(loadOrder.indexOf("d")).toBe(3);
      expect(loadOrder).toContain("b");
      expect(loadOrder).toContain("c");
    });

    it("handles mixed scenario (some with deps, some without)", async () => {
      const loadOrder: string[] = [];

      const pluginIndependent: IPlugin = {
        manifest: { name: "independent", version: "1.0.0" },
        factory: async () => {
          loadOrder.push("independent");
          return {};
        },
      };

      const pluginProvider: IPlugin = {
        manifest: { name: "provider", version: "1.0.0", services: ["service-x"] },
        factory: async (ctx) => {
          loadOrder.push("provider");
          ctx.services?.register({ name: "service-x", version: "1.0.0" });
          return {};
        },
      };

      const pluginConsumer: IPlugin = {
        manifest: { name: "consumer", version: "1.0.0", serviceDependencies: ["service-x"] },
        factory: async () => {
          loadOrder.push("consumer");
          return {};
        },
      };

      await loader.loadAll([pluginConsumer, pluginIndependent, pluginProvider], createMockContext);

      // Provider must come before consumer
      expect(loadOrder.indexOf("provider")).toBeLessThan(loadOrder.indexOf("consumer"));
      // Independent can be anywhere
      expect(loadOrder).toContain("independent");
    });
  });

  describe("loadAll", () => {
    it("loads plugins in dependency order", async () => {
      const loadOrder: string[] = [];

      const pluginA: IPlugin = {
        manifest: { name: "a", version: "1.0.0", services: ["service-a"] },
        factory: async (ctx) => {
          loadOrder.push("a");
          ctx.services?.register({ name: "service-a", version: "1.0.0" });
          return {};
        },
      };

      const pluginB: IPlugin = {
        manifest: { name: "b", version: "1.0.0", serviceDependencies: ["service-a"] },
        factory: async () => {
          loadOrder.push("b");
          return {};
        },
      };

      await loader.loadAll([pluginB, pluginA], createMockContext);

      expect(loadOrder).toEqual(["a", "b"]);
    });

    it("calls ctxFactory for each plugin", async () => {
      const ctxFactoryCalls: string[] = [];

      const pluginA: IPlugin = {
        manifest: { name: "a", version: "1.0.0" },
        factory: async () => ({}),
      };

      const pluginB: IPlugin = {
        manifest: { name: "b", version: "1.0.0" },
        factory: async () => ({}),
      };

      const ctxFactory = (plugin: IPlugin) => {
        ctxFactoryCalls.push(plugin.manifest.name);
        return createMockContext();
      };

      await loader.loadAll([pluginA, pluginB], ctxFactory);

      expect(ctxFactoryCalls).toEqual(["a", "b"]);
    });

    it("registers hooks after successful load", async () => {
      const testTool = {
        id: "test-tool",
        name: "Test Tool",
        description: "Test",
        parameters: {},
        execute: async () => ({ success: true }),
      };

      const plugin: IPlugin = {
        manifest: { name: "with-tools", version: "1.0.0" },
        factory: async () => ({
          tools: [testTool],
        }),
      };

      await loader.loadAll([plugin], createMockContext);

      expect(deps.toolRegistry.get("test-tool")).toBe(testTool);
    });

    it("backward compatible: no deps = config order", async () => {
      const loadOrder: string[] = [];

      const pluginA: IPlugin = {
        manifest: { name: "a", version: "1.0.0" },
        factory: async () => {
          loadOrder.push("a");
          return {};
        },
      };

      const pluginB: IPlugin = {
        manifest: { name: "b", version: "1.0.0" },
        factory: async () => {
          loadOrder.push("b");
          return {};
        },
      };

      await loader.loadAll([pluginA, pluginB], createMockContext);

      expect(loadOrder).toEqual(["a", "b"]);
    });

    it("handles mixed scenario correctly", async () => {
      const loadOrder: string[] = [];

      const plugin1: IPlugin = {
        manifest: { name: "independent-1", version: "1.0.0" },
        factory: async () => {
          loadOrder.push("independent-1");
          return {};
        },
      };

      const plugin2: IPlugin = {
        manifest: { name: "provider", version: "1.0.0", services: ["my-service"] },
        factory: async (ctx) => {
          loadOrder.push("provider");
          ctx.services?.register({ name: "my-service", version: "1.0.0" });
          return {};
        },
      };

      const plugin3: IPlugin = {
        manifest: { name: "consumer", version: "1.0.0", serviceDependencies: ["my-service"] },
        factory: async () => {
          loadOrder.push("consumer");
          return {};
        },
      };

      const plugin4: IPlugin = {
        manifest: { name: "independent-2", version: "1.0.0" },
        factory: async () => {
          loadOrder.push("independent-2");
          return {};
        },
      };

      await loader.loadAll([plugin1, plugin3, plugin2, plugin4], createMockContext);

      // Provider before consumer
      expect(loadOrder.indexOf("provider")).toBeLessThan(loadOrder.indexOf("consumer"));
      // Independent plugins preserve relative order
      expect(loadOrder.indexOf("independent-1")).toBeLessThan(loadOrder.indexOf("independent-2"));
    });

    it("stops loading on first error", async () => {
      const loadOrder: string[] = [];

      const pluginA: IPlugin = {
        manifest: { name: "a", version: "1.0.0" },
        factory: async () => {
          loadOrder.push("a");
          return {};
        },
      };

      const pluginB: IPlugin = {
        manifest: { name: "b", version: "1.0.0" },
        factory: async () => {
          throw new Error("Load error");
        },
      };

      const pluginC: IPlugin = {
        manifest: { name: "c", version: "1.0.0" },
        factory: async () => {
          loadOrder.push("c");
          return {};
        },
      };

      await expect(loader.loadAll([pluginA, pluginB, pluginC], createMockContext)).rejects.toThrow();

      // Only A should have loaded (B fails, C never loads)
      expect(loadOrder).toEqual(["a"]);
    });
  });
});
