/**
 * PluginLoader — loads plugins and registers their hooks into registries.
 */

import type { IPlugin, IPluginContext, PluginHooks, EventBus, Skandha, IVolition, IConfidenceAuditor, IContextManager, IConfirmationGate } from "@openstarry/sdk";
import { AgentEventType, PluginLoadError, ServiceKey } from "@openstarry/sdk";
import type { IPluginService } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";
import { checkSkandhaCorrespondence } from "./skandha-check.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { ProviderRegistry } from "./provider-registry.js";
import type { ListenerRegistry } from "./listener-registry.js";
import type { UIRegistry } from "./ui-registry.js";
import type { GuideRegistry } from "./guide-registry.js";
import type { CommandRegistry } from "./command-registry.js";
import type { VedanaRegistry } from "./vedana-registry.js";
import type { CommChannelRegistry } from "./comm-channel-registry.js";
import type { GearArbiterRegistry } from "../mano/gear-arbiter-registry.js";
import type { MonitorRegistry } from "./monitor-registry.js";
import type { PluginSandboxManager } from "../sandbox/index.js";
import type { SignatureVerifier } from "../sandbox/signature-verification.js";

const logger = createLogger("PluginLoader");

const VALID_SKANDHA_VALUES: ReadonlySet<Skandha> = new Set([
  'rupa', 'vedana', 'samjna', 'samskara', 'vijnana',
]);

/**
 * Validates that a plugin manifest's skandha field contains valid Skandha values.
 * Logs a warning if invalid values are found. Does NOT block loading.
 */
function validatePluginSkandha(plugin: IPlugin): void {
  const { name, skandha } = plugin.manifest;
  if (skandha == null) return;

  const values: ReadonlyArray<unknown> = Array.isArray(skandha) ? skandha : [skandha];
  for (const val of values) {
    if (!VALID_SKANDHA_VALUES.has(val as Skandha)) {
      logger.warn(
        `Plugin "${name}" has invalid skandha value: "${val}". ` +
        `Valid values are: ${[...VALID_SKANDHA_VALUES].join(', ')}.`
      );
    }
  }
}

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

  // Build plugin-name lookup for dependencies (Plan33 OQ-33-1)
  const nameToPlugin = new Map<string, IPlugin>();
  for (const plugin of plugins) {
    nameToPlugin.set(plugin.manifest.name, plugin);
  }

  // Build edges: if B depends on A, add edge A -> B
  for (const plugin of plugins) {
    // Service-level dependencies (existing, Plan19)
    const serviceDeps = plugin.manifest.serviceDependencies;
    if (serviceDeps && serviceDeps.length > 0) {
      for (const serviceName of serviceDeps) {
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

    // Plugin-name dependencies (Plan33 OQ-33-1, RES-D2-1)
    const pluginDeps = plugin.manifest.dependencies;
    if (pluginDeps && pluginDeps.length > 0) {
      // Hotfix: cap dependencies length to prevent DoS (SEC-033-002)
      if (pluginDeps.length > 50) {
        logger.warn(
          `Plugin "${plugin.manifest.name}" declares ${pluginDeps.length} dependencies (max 50). Truncating.`
        );
      }
      const safeDeps = pluginDeps.slice(0, 50);
      for (const depName of safeDeps) {
        const depPlugin = nameToPlugin.get(depName);
        if (depPlugin) {
          dependencyGraph.get(plugin)!.add(depPlugin);
          inDegree.set(plugin, (inDegree.get(plugin) ?? 0) + 1);
        }
        // Missing dependency validation happens in loadAll() after sort
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
  /** Get the last-registered IVolition from plugins (Plan28). */
  getVolition(): IVolition | null;
  /** Get the last-registered IConfidenceAuditor from plugins (Plan29). */
  getAuditor(): IConfidenceAuditor | null;
  /** Get the last-registered IContextManager from plugins (Plan32 Wave 6). */
  getContextManager(): IContextManager | null;
  /** Get the last-registered IConfirmationGate from plugins (Plan36b). */
  getConfirmationGate(): IConfirmationGate | null;
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
  vedanaRegistry?: VedanaRegistry;
  gearArbiterRegistry?: GearArbiterRegistry;
  monitorRegistry?: MonitorRegistry;
  commChannelRegistry?: CommChannelRegistry;
  sandboxManager?: PluginSandboxManager;
  /** EventBus for emitting signature verification events. */
  bus?: EventBus;
  /** Signature verifier for integrity checks (applies to ALL plugins, not just sandboxed). */
  signatureVerifier?: SignatureVerifier;
}

export function createPluginLoader(deps: PluginLoaderDeps): PluginLoader {
  const loadedHooks: PluginHooks[] = [];
  let registeredVolition: IVolition | null = null;
  let registeredAuditor: IConfidenceAuditor | null = null;
  let registeredContextManager: IContextManager | null = null;
  let registeredConfirmationGate: IConfirmationGate | null = null;

  return {
    async load(plugin: IPlugin, ctx: IPluginContext): Promise<PluginHooks> {
      const name = plugin.manifest.name;
      const sandboxEnabled = plugin.manifest.sandbox?.enabled === true;
      logger.info(`Loading plugin: ${name} v${plugin.manifest.version}`, {
        sandbox: sandboxEnabled && !!deps.sandboxManager,
      });

      // Validate skandha field if present (warning only, does not block loading)
      validatePluginSkandha(plugin);

      // Check service dependencies (soft validation - warnings only)
      if (plugin.manifest.serviceDependencies && plugin.manifest.serviceDependencies.length > 0) {
        const missingServices: string[] = [];
        for (const serviceName of plugin.manifest.serviceDependencies) {
          if (!ctx.services?.get(new ServiceKey<IPluginService>(serviceName))) {
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

      // Signature verification for non-sandbox plugins (sandbox path does its own verification)
      if (!sandboxEnabled && deps.signatureVerifier && plugin.manifest.integrity) {
        const manifestAny = plugin.manifest as unknown as Record<string, unknown>;
        const pluginFilePath = manifestAny.ref
          ? (manifestAny.ref as { path?: string })?.path
          : undefined;

        if (pluginFilePath) {
          try {
            await deps.signatureVerifier.verifyPlugin(plugin, pluginFilePath);
            deps.bus?.emit({
              type: AgentEventType.SANDBOX_SIGNATURE_VERIFIED,
              timestamp: Date.now(),
              payload: { pluginName: name },
            });
          } catch (err) {
            deps.bus?.emit({
              type: AgentEventType.SANDBOX_SIGNATURE_FAILED,
              timestamp: Date.now(),
              payload: { pluginName: name, error: err instanceof Error ? err.message : String(err) },
            });
            throw new PluginLoadError(
              name,
              `Signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
              err instanceof Error ? err : undefined,
            );
          }
        } else {
          logger.warn("Signature verification skipped (no file path)", { plugin: name });
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

      // Plan33 02-8 T3: Skandha correspondence check (L2 + L3)
      const skandhaViolations = checkSkandhaCorrespondence(plugin.manifest, hooks, logger);
      if (skandhaViolations.length > 0 && deps.bus) {
        deps.bus.emit({
          type: "skandha:mismatch",
          timestamp: Date.now(),
          payload: {
            pluginName: name,
            violations: skandhaViolations,
          },
        });
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
      if (hooks.vedanaSensors && deps.vedanaRegistry) {
        for (const sensor of hooks.vedanaSensors) {
          deps.vedanaRegistry.register(sensor);
        }
      }
      if (hooks.gearArbiters && deps.gearArbiterRegistry) {
        for (const arbiter of hooks.gearArbiters) {
          deps.gearArbiterRegistry.register(arbiter);
        }
      }
      // Plan28: IVolition registration (last-wins: latest plugin's volition replaces previous)
      if (hooks.volition) {
        registeredVolition = hooks.volition;
        logger.info(`Registered IVolition from plugin: ${name}`);
      }
      // Plan29: ILoopQualityMonitor registration (array slot)
      if (hooks.monitors && deps.monitorRegistry) {
        for (const monitor of hooks.monitors) {
          deps.monitorRegistry.register(monitor);
        }
      }
      // Plan29: IConfidenceAuditor registration (last-wins)
      if (hooks.auditor) {
        if (registeredAuditor) {
          logger.warn(`IConfidenceAuditor replaced: previous auditor overridden by plugin "${name}" (last-wins policy)`);
        }
        registeredAuditor = hooks.auditor;
        logger.info(`Registered IConfidenceAuditor from plugin: ${name}`);
      }
      // Plan32 Wave 6: IContextManager registration (last-wins)
      if (hooks.contextManager) {
        if (registeredContextManager) {
          logger.warn(`IContextManager replaced: previous context manager overridden by plugin "${name}" (last-wins policy)`);
        }
        registeredContextManager = hooks.contextManager;
        logger.info(`Registered IContextManager from plugin: ${name}`);
      }
      // Plan36b: IConfirmationGate registration (last-wins)
      if (hooks.confirmationGate) {
        if (registeredConfirmationGate) {
          logger.warn(`IConfirmationGate replaced: previous gate overridden by plugin "${name}" (last-wins policy)`);
        }
        registeredConfirmationGate = hooks.confirmationGate;
        logger.info(`Registered IConfirmationGate from plugin: ${name}`);
      }
      // Plan37 C6: ICommChannel registration (array slot)
      if (hooks.commChannels && deps.commChannelRegistry) {
        for (const channel of hooks.commChannels) {
          deps.commChannelRegistry.register(channel);
        }
      }

      loadedHooks.push(hooks);
      logger.info(`Plugin loaded: ${name}`);
      return hooks;
    },

    getLoadedHooks(): PluginHooks[] {
      return [...loadedHooks];
    },

    getVolition(): IVolition | null {
      return registeredVolition;
    },

    getAuditor(): IConfidenceAuditor | null {
      return registeredAuditor;
    },

    getContextManager(): IContextManager | null {
      return registeredContextManager;
    },

    getConfirmationGate(): IConfirmationGate | null {
      return registeredConfirmationGate;
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

      // Sort plugins by dependencies (includes plugin-name edges from Plan33)
      const sortedPlugins = topologicalSort(plugins);

      logger.debug(
        `Plugin load order: ${sortedPlugins.map(p => p.manifest.name).join(" → ")}`
      );

      // Plan33 OQ-33-1: Validate plugin-name dependencies before loading
      const loadedPluginNames = new Set<string>();
      const skippedPlugins = new Set<string>();

      // Load in dependency order
      for (const plugin of sortedPlugins) {
        // Check plugin-name dependencies (Plan33 OQ-33-1, KD-1: hard error → skip)
        const deps = plugin.manifest.dependencies?.slice(0, 50);
        if (deps && deps.length > 0) {
          const missingDeps = deps.filter(d => !loadedPluginNames.has(d));
          if (missingDeps.length > 0) {
            logger.error(
              `Plugin "${plugin.manifest.name}" requires [${missingDeps.join(", ")}] but ${missingDeps.length === 1 ? "it is" : "they are"} not loaded. Skipping plugin.`
            );
            skippedPlugins.add(plugin.manifest.name);
            continue;
          }
        }

        const ctx = ctxFactory(plugin);
        await this.load(plugin, ctx);
        loadedPluginNames.add(plugin.manifest.name);
      }

      if (skippedPlugins.size > 0) {
        logger.warn(`${skippedPlugins.size} plugin(s) skipped due to missing dependencies: ${[...skippedPlugins].join(", ")}`);
      }

      logger.info(`All ${plugins.length - skippedPlugins.size}/${plugins.length} plugins loaded successfully`);
    },
  };
}
