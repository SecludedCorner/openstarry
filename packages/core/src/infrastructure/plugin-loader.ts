/**
 * PluginLoader — loads plugins and registers their hooks into registries.
 */

import type { IPlugin, IPluginContext, PluginHooks } from "@openstarry/sdk";
import { PluginLoadError } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";
import type { ToolRegistry } from "./tool-registry.js";
import type { ProviderRegistry } from "./provider-registry.js";
import type { ListenerRegistry } from "./listener-registry.js";
import type { UIRegistry } from "./ui-registry.js";
import type { GuideRegistry } from "./guide-registry.js";
import type { CommandRegistry } from "./command-registry.js";
import type { PluginSandboxManager } from "../sandbox/index.js";

const logger = createLogger("PluginLoader");

/**
 * Topological sort of plugins based on PluginManifest.serviceDependencies.
 * Uses Kahn's algorithm.
 *
 * Algorithm:
 * 1. Build directed graph: if Plugin B has serviceDependencies including a service
 *    provided by Plugin A (via manifest.services), then B depends on A
 * 2. Compute in-degree for each plugin
 * 3. Queue all plugins with in-degree 0
 * 4. Process queue: dequeue, add to sorted, decrement dependents' in-degrees
 * 5. If sorted.length < total → circular dependency detected
 *
 * For plugins without serviceDependencies, preserve config order.
 *
 * @throws PluginLoadError if circular dependency detected
 */
function topologicalSort(plugins: IPlugin[]): IPlugin[] {
  // Build service -> provider plugin map
  const serviceToProvider = new Map<string, IPlugin>();
  for (const plugin of plugins) {
    if (plugin.manifest.services) {
      for (const serviceName of plugin.manifest.services) {
        serviceToProvider.set(serviceName, plugin);
      }
    }
  }

  // Build dependency graph: plugin -> set of plugins it depends on
  const dependencyGraph = new Map<IPlugin, Set<IPlugin>>();
  const inDegree = new Map<IPlugin, number>();

  // Initialize all plugins
  for (const plugin of plugins) {
    dependencyGraph.set(plugin, new Set());
    inDegree.set(plugin, 0);
  }

  // Build edges: if B depends on A, add edge A -> B
  for (const plugin of plugins) {
    const deps = plugin.manifest.serviceDependencies;
    if (deps && deps.length > 0) {
      for (const serviceName of deps) {
        const provider = serviceToProvider.get(serviceName);
        if (provider) {
          // plugin depends on provider, so provider -> plugin edge
          dependencyGraph.get(plugin)!.add(provider);
          // Increment in-degree of the dependent plugin
          inDegree.set(plugin, (inDegree.get(plugin) ?? 0) + 1);
        } else {
          // Service not provided by any plugin in this batch - log debug warning
          logger.debug(
            `Plugin "${plugin.manifest.name}" depends on service "${serviceName}" which is not provided by any plugin in this batch. ` +
            `It may be registered dynamically.`
          );
        }
      }
    }
  }

  // Kahn's algorithm
  const queue: IPlugin[] = [];
  const sorted: IPlugin[] = [];

  // Enqueue all plugins with in-degree 0
  for (const plugin of plugins) {
    if ((inDegree.get(plugin) ?? 0) === 0) {
      queue.push(plugin);
    }
  }

  // Maintain original order for plugins with same priority
  const originalIndices = new Map<IPlugin, number>();
  plugins.forEach((plugin, index) => originalIndices.set(plugin, index));

  while (queue.length > 0) {
    // Sort queue by original index to preserve config order for independent plugins
    queue.sort((a, b) => (originalIndices.get(a) ?? 0) - (originalIndices.get(b) ?? 0));
    const current = queue.shift()!;
    sorted.push(current);

    // For each plugin that depends on current, decrement its in-degree
    for (const [plugin, deps] of dependencyGraph.entries()) {
      if (deps.has(current)) {
        deps.delete(current);
        const newInDegree = (inDegree.get(plugin) ?? 0) - 1;
        inDegree.set(plugin, newInDegree);
        if (newInDegree === 0) {
          queue.push(plugin);
        }
      }
    }
  }

  // Check for circular dependencies
  if (sorted.length < plugins.length) {
    const unsorted = plugins.filter(p => !sorted.includes(p));
    const names = unsorted.map(p => p.manifest.name).join(", ");
    throw new PluginLoadError(
      "circular-dependency",
      `Circular dependency detected among plugins: ${names}`
    );
  }

  return sorted;
}

export interface PluginLoader {
  load(plugin: IPlugin, ctx: IPluginContext): Promise<PluginHooks>;
  getLoadedHooks(): PluginHooks[];
  disposeAll(): Promise<void>;
  loadAll(
    plugins: IPlugin[],
    ctxFactory: (plugin: IPlugin) => IPluginContext
  ): Promise<void>;
}

export interface PluginLoaderDeps {
  toolRegistry: ToolRegistry;
  providerRegistry: ProviderRegistry;
  listenerRegistry: ListenerRegistry;
  uiRegistry: UIRegistry;
  guideRegistry: GuideRegistry;
  commandRegistry: CommandRegistry;
  sandboxManager?: PluginSandboxManager;
}

export function createPluginLoader(deps: PluginLoaderDeps): PluginLoader {
  const loadedHooks: PluginHooks[] = [];

  return {
    async load(plugin: IPlugin, ctx: IPluginContext): Promise<PluginHooks> {
      const name = plugin.manifest.name;
      const sandboxEnabled = plugin.manifest.sandbox?.enabled === true;
      logger.info(`Loading plugin: ${name} v${plugin.manifest.version}`, {
        sandbox: sandboxEnabled && !!deps.sandboxManager,
      });

      // Check service dependencies (soft validation - warnings only)
      if (plugin.manifest.serviceDependencies && plugin.manifest.serviceDependencies.length > 0) {
        const missingServices: string[] = [];
        for (const serviceName of plugin.manifest.serviceDependencies) {
          if (!ctx.services?.get(serviceName)) {
            missingServices.push(serviceName);
          }
        }
        if (missingServices.length > 0) {
          logger.warn(
            `Plugin "${name}" requires missing services: ${missingServices.join(", ")}. ` +
            `Plugin will still load, but functionality may be limited.`
          );
        }
      }

      let hooks: PluginHooks;
      try {
        if (sandboxEnabled && deps.sandboxManager) {
          hooks = await deps.sandboxManager.loadInSandbox(plugin, ctx);
        } else {
          hooks = await plugin.factory(ctx);
        }
      } catch (err) {
        throw new PluginLoadError(
          name,
          err instanceof Error ? err.message : String(err),
          err instanceof Error ? err : undefined,
        );
      }

      // Register all hooks into their respective registries
      if (hooks.tools) {
        for (const tool of hooks.tools) {
          deps.toolRegistry.register(tool);
        }
      }
      if (hooks.providers) {
        for (const provider of hooks.providers) {
          deps.providerRegistry.register(provider);
        }
      }
      if (hooks.listeners) {
        for (const listener of hooks.listeners) {
          deps.listenerRegistry.register(listener);
        }
      }
      if (hooks.ui) {
        for (const ui of hooks.ui) {
          deps.uiRegistry.register(ui);
        }
      }
      if (hooks.guides) {
        for (const guide of hooks.guides) {
          deps.guideRegistry.register(guide);
        }
      }
      if (hooks.commands) {
        for (const command of hooks.commands) {
          deps.commandRegistry.register(command);
        }
      }

      loadedHooks.push(hooks);
      logger.info(`Plugin loaded: ${name}`);
      return hooks;
    },

    getLoadedHooks(): PluginHooks[] {
      return [...loadedHooks];
    },

    async disposeAll(): Promise<void> {
      for (const hooks of loadedHooks) {
        if (hooks.dispose) {
          try {
            await hooks.dispose();
          } catch (err) {
            logger.error("Error disposing plugin", { error: String(err) });
          }
        }
      }
      loadedHooks.length = 0;
      // Shutdown all sandbox workers
      if (deps.sandboxManager) {
        await deps.sandboxManager.shutdownAll();
      }
    },

    async loadAll(
      plugins: IPlugin[],
      ctxFactory: (plugin: IPlugin) => IPluginContext
    ): Promise<void> {
      logger.info(`Loading ${plugins.length} plugins with dependency sorting`);

      // Sort plugins by dependencies
      const sortedPlugins = topologicalSort(plugins);

      logger.debug(
        `Plugin load order: ${sortedPlugins.map(p => p.manifest.name).join(" → ")}`
      );

      // Load in dependency order
      for (const plugin of sortedPlugins) {
        const ctx = ctxFactory(plugin);
        await this.load(plugin, ctx);
      }

      logger.info(`All ${plugins.length} plugins loaded successfully`);
    },
  };
}
