/**
 * AgentCore — the main orchestrator that wires all subsystems together.
 *
 * **Event-driven architecture (Plan02 refactor):**
 * - All external input goes through EventQueue as InputEvent
 * - ExecutionLoop pulls from EventQueue (sole input source)
 * - Slash commands use a fast path (bypass LLM loop)
 * - isProcessing lock prevents concurrent event handling
 */

import type {
  IAgentConfig,
  IPlugin,
  IPluginContext,
  EventBus,
  IProvider,
  IGuide,
  InputEvent,
  ISessionManager,
  IServiceRegistry,
  PluginManifest,
  ICognitionConfigService,
} from "@openstarry/sdk";
import { AgentEventType, getSessionConfig } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";
import { createEventBus } from "../bus/index.js";
import { createEventQueue, type EventQueue } from "../execution/queue.js";
import { createExecutionLoop, type ExecutionLoop } from "../execution/loop.js";
import { createSessionManager } from "../session/manager.js";
import { createContextManager } from "../memory/context.js";
import {
  createToolRegistry,
  createProviderRegistry,
  createListenerRegistry,
  createUIRegistry,
  createGuideRegistry,
  createCommandRegistry,
  createServiceRegistry,
  createPluginLoader,
  type ToolRegistry,
  type ProviderRegistry,
  type ListenerRegistry,
  type UIRegistry,
  type GuideRegistry,
  type CommandRegistry,
  type ServiceRegistry,
} from "../infrastructure/index.js";
import { createSecurityLayer, type SecurityLayer } from "../security/guardrails.js";
import { createSafetyMonitor, type SafetyMonitor } from "../security/safety-monitor.js";
import { createTransportBridge } from "../transport/bridge.js";
import type { IContextManager } from "@openstarry/sdk";
import { createMetricsCollector } from "../observability/index.js";
import type { MetricsCollector } from "../observability/index.js";
import { createPluginSandboxManager, type PluginSandboxManager } from "../sandbox/index.js";

const logger = createLogger("AgentCore");

export interface AgentCore {
  readonly bus: EventBus;
  readonly queue: EventQueue;
  readonly config: IAgentConfig;
  readonly toolRegistry: ToolRegistry;
  readonly providerRegistry: ProviderRegistry;
  readonly listenerRegistry: ListenerRegistry;
  readonly uiRegistry: UIRegistry;
  readonly guideRegistry: GuideRegistry;
  readonly commandRegistry: CommandRegistry;
  readonly serviceRegistry: IServiceRegistry;
  readonly sessionManager: ISessionManager;
  readonly security: SecurityLayer;
  readonly safetyMonitor: SafetyMonitor;
  readonly metrics: MetricsCollector;

  loadPlugin(plugin: IPlugin): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Push an input event into the queue (preferred way for external input). */
  pushInput(inputEvent: InputEvent): void;
  /** Legacy convenience: wraps string input as InputEvent and pushes to queue. */
  processInput(input: string, source?: string): void;
  reset(): void;
}

export function createAgentCore(config: IAgentConfig): AgentCore {
  const bus = createEventBus();
  const queue = createEventQueue();
  const sessionManager = createSessionManager(bus);
  const contextManager = createContextManager();

  const toolRegistry = createToolRegistry();
  const providerRegistry = createProviderRegistry();
  const listenerRegistry = createListenerRegistry();
  const uiRegistry = createUIRegistry();
  const guideRegistry = createGuideRegistry();
  const commandRegistry = createCommandRegistry();
  const serviceRegistry = createServiceRegistry();

  const security = createSecurityLayer(
    config.capabilities.allowedPaths ?? [config.identity.id],
    (sessionId?: string) => {
      if (!sessionId) return undefined;
      const session = sessionManager.get(sessionId);
      return session ? getSessionConfig(session.metadata) : undefined;
    },
  );

  const safetyMonitor = createSafetyMonitor({
    maxLoopTicks: config.policy?.maxConcurrentTools
      ? config.policy.maxConcurrentTools * 10
      : 50,
    maxTokenUsage: 0, // Unlimited by default for MVP
  });

  const metrics = createMetricsCollector();

  // Create sandbox manager for plugin isolation
  const sandboxManager = createPluginSandboxManager({
    bus,
    pushInput: (event) => core.pushInput(event),
    sessions: sessionManager,
    tools: {
      list: () => toolRegistry.list(),
      get: (id: string) => toolRegistry.get(id),
    },
    guides: {
      list: () => guideRegistry.list(),
    },
    providers: {
      list: () => providerRegistry.list(),
      get: (id: string) => providerRegistry.get(id),
    },
    services: serviceRegistry,
    commands: {
      list: () => commandRegistry.list(),
    },
    metrics: {
      getSnapshot: () => metrics.getSnapshot() as unknown,
    },
  });

  const pluginLoader = createPluginLoader({
    toolRegistry,
    providerRegistry,
    listenerRegistry,
    uiRegistry,
    guideRegistry,
    commandRegistry,
    sandboxManager,
  });

  const bridge = createTransportBridge(bus, uiRegistry);
  let bridgeUnsub: (() => void) | null = null;
  let executionLoop: ExecutionLoop | null = null;

  // Reset safety monitor when state is reset (e.g., by /reset command from plugin)
  bus.on(AgentEventType.STATE_RESET, () => safetyMonitor.reset());

  function getPluginContext(pluginConfig?: Record<string, unknown>, pluginManifest?: PluginManifest): IPluginContext {
    // Filter providers based on manifest capabilities
    const allowedProviderIds = pluginManifest?.capabilities?.allowedProviders;
    const shouldFilterProviders = allowedProviderIds && allowedProviderIds.length > 0;

    return {
      bus,
      workingDirectory: process.cwd(),
      agentId: config.identity.id,
      config: pluginConfig ?? {},
      pushInput: (event) => core.pushInput(event),
      sessions: sessionManager,
      tools: {
        list: () => toolRegistry.list(),
        get: (id: string) => toolRegistry.get(id),
      },
      guides: {
        list: () => guideRegistry.list(),
      },
      providers: {
        list: () => {
          const allProviders = providerRegistry.list();
          if (!shouldFilterProviders) return allProviders;
          return allProviders.filter(p => allowedProviderIds.includes(p.id));
        },
        get: (id: string) => {
          if (shouldFilterProviders && !allowedProviderIds.includes(id)) return undefined;
          return providerRegistry.get(id);
        },
      },
      services: serviceRegistry,
      commands: {
        list: () => commandRegistry.list(),
      },
      metrics: {
        getSnapshot: () => ({ ...metrics.getSnapshot() }),
      },
    };
  }

  function resolveModel(sessionId?: string): string | undefined {
    const cogSvc = serviceRegistry.get<ICognitionConfigService>("cognition-config");
    if (cogSvc) {
      const model = cogSvc.getModel(sessionId);
      if (model) return model;
    }
    return config.cognition.model || undefined;
  }

  function resolveProvider(sessionId?: string): IProvider {
    const model = resolveModel(sessionId);

    // Try runtime model → config model resolution
    if (model) {
      const resolved = providerRegistry.resolveModel(model);
      if (resolved) return resolved.provider;
    }

    // Try runtime provider via cognition service → config provider
    const cogSvc = serviceRegistry.get<ICognitionConfigService>("cognition-config");
    const runtimeProv = cogSvc?.getProvider(sessionId);
    const providerId = runtimeProv || config.cognition.provider;
    if (providerId) {
      const provider = providerRegistry.get(providerId);
      if (provider) return provider;
    }

    throw new Error(
      "No provider/model configured. Use /provider login <name> <key> then /provider model <id> to select a model.\n" +
      `Available providers: ${providerRegistry.list().map((p) => p.id).join(", ") || "none"}`,
    );
  }

  function resolveGuide(): IGuide | undefined {
    // Explicit guide ID takes precedence
    if (config.guide) {
      return guideRegistry.get(config.guide);
    }
    return undefined;
  }

  /**
   * Handle slash commands via fast path (no EventQueue, no LLM).
   * Returns true if the input was a slash command that was handled.
   */
  async function handleSlashCommand(input: string, sessionId?: string): Promise<boolean> {
    if (!input.startsWith("/")) return false;

    const parts = input.slice(1).split(/\s+/);
    const cmdName = parts[0];
    const cmdArgs = parts.slice(1).join(" ");

    const ctx = getPluginContext();
    const result = await commandRegistry.execute(cmdName, cmdArgs, ctx, sessionId);
    if (result !== undefined) {
      bus.emit({
        type: AgentEventType.MESSAGE_SYSTEM,
        timestamp: Date.now(),
        payload: { text: result, sessionId },
      });
      return true;
    }
    return false;
  }

  const core: AgentCore = {
    bus,
    queue,
    config,
    toolRegistry,
    providerRegistry,
    listenerRegistry,
    uiRegistry,
    guideRegistry,
    commandRegistry,
    serviceRegistry,
    sessionManager,
    security,
    safetyMonitor,
    metrics,

    async loadPlugin(plugin: IPlugin): Promise<void> {
      const pluginRef = config.plugins.find((p) => p.name === plugin.manifest.name);
      const ctx = getPluginContext(pluginRef?.config, plugin.manifest);
      await pluginLoader.load(plugin, ctx);
      bus.emit({
        type: AgentEventType.PLUGIN_LOADED,
        timestamp: Date.now(),
        payload: { name: plugin.manifest.name },
      });
    },

    async start(): Promise<void> {
      logger.info(`Starting agent: ${config.identity.name} (${config.identity.id})`);

      // Start transport bridge
      bridgeUnsub = bridge.start();

      // Create and start the execution loop
      executionLoop = createExecutionLoop({
        bus,
        queue,
        sessionManager,
        contextManager,
        toolRegistry,
        security,
        safetyMonitor,
        providerResolver: (sessionId?: string) => resolveProvider(sessionId),
        guideResolver: resolveGuide,
        modelResolver: (sessionId?: string) => resolveModel(sessionId),
        maxToolRounds: config.cognition.maxToolRounds ?? 10,
        slidingWindowSize: config.memory?.slidingWindowSize ?? 5,
        workingDirectory: process.cwd(),
        temperature: config.cognition.temperature,
        maxTokens: config.cognition.maxTokens,
        toolTimeout: config.policy?.toolTimeout ?? 30000,
      });
      executionLoop.start();

      // Wire metrics auto-counters
      bus.on(AgentEventType.TOOL_EXECUTING, () => metrics.increment("tool.calls.total"));
      bus.on(AgentEventType.TOOL_ERROR, () => metrics.increment("tool.calls.errors"));
      bus.on(AgentEventType.PROVIDER_ERROR, () => metrics.increment("provider.calls.errors"));
      bus.on(AgentEventType.SESSION_CREATED, () => metrics.increment("session.created"));
      bus.on(AgentEventType.SESSION_DESTROYED, () => metrics.increment("session.destroyed"));

      // Start all listeners (受蘊)
      for (const listener of listenerRegistry.list()) {
        if (listener.start) {
          await listener.start();
        }
      }

      // Start all UIs (色蘊)
      for (const ui of uiRegistry.list()) {
        if (ui.start) {
          await ui.start();
        }
      }

      bus.emit({
        type: AgentEventType.AGENT_STARTED,
        timestamp: Date.now(),
        payload: { identity: config.identity },
      });

      logger.info("Agent started");
    },

    async stop(): Promise<void> {
      logger.info("Stopping agent...");

      // Stop execution loop
      if (executionLoop) {
        executionLoop.stop();
        executionLoop = null;
      }

      // Stop listeners (受蘊)
      for (const listener of listenerRegistry.list()) {
        if (listener.stop) {
          await listener.stop();
        }
      }

      // Stop UIs (色蘊)
      for (const ui of uiRegistry.list()) {
        if (ui.stop) {
          await ui.stop();
        }
      }

      // Stop transport bridge
      if (bridgeUnsub) {
        bridgeUnsub();
        bridgeUnsub = null;
      }

      // Dispose plugins
      await pluginLoader.disposeAll();

      bus.emit({
        type: AgentEventType.AGENT_STOPPED,
        timestamp: Date.now(),
      });

      logger.info("Agent stopped");
    },

    pushInput(inputEvent: InputEvent): void {
      // Slash commands go through fast path
      if (typeof inputEvent.data === "string" && inputEvent.data.startsWith("/")) {
        handleSlashCommand(inputEvent.data, inputEvent.sessionId).then((handled) => {
          if (!handled) {
            // Not a known command — push to queue for LLM processing
            queue.push({
              type: AgentEventType.INPUT_RECEIVED,
              timestamp: Date.now(),
              payload: inputEvent,
            });
          }
        }).catch((err) => {
          logger.error("Slash command error", { error: String(err) });
        });
        return;
      }

      // Regular input → push to queue
      queue.push({
        type: AgentEventType.INPUT_RECEIVED,
        timestamp: Date.now(),
        payload: inputEvent,
      });
    },

    processInput(input: string, source = "cli"): void {
      core.pushInput({
        source,
        inputType: "user_input",
        data: input,
      });
    },

    reset(): void {
      sessionManager.getStateManager().clear();
      safetyMonitor.reset();
      bus.emit({
        type: AgentEventType.STATE_RESET,
        timestamp: Date.now(),
      });
      logger.info("Conversation reset");
    },
  };

  return core;
}

