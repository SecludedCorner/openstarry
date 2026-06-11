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
  KleshaSignalBundle,
  VedanaAssessment,
  ChannelVedana,
} from "@openstarry/sdk";
import { AgentEventType, getSessionConfig, classifyVedana, DEFAULT_VEDANA_CONFIG, SERVICE_KEYS } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";
import { createEventBus } from "../bus/index.js";
import { createEventQueue, type EventQueue } from "../execution/queue.js";
import { createExecutionLoop, type ExecutionLoop } from "../execution/loop.js";
import { createSessionManager } from "../session/manager.js";
import type { IContextManager } from "@openstarry/sdk";
import {
  createToolRegistry,
  createProviderRegistry,
  createListenerRegistry,
  createUIRegistry,
  createGuideRegistry,
  createCommandRegistry,
  createServiceRegistry,
  createPluginLoader,
  createVedanaRegistry,
  createMonitorRegistry,
  createCommChannelRegistry,
  type ToolRegistry,
  type ProviderRegistry,
  type ListenerRegistry,
  type UIRegistry,
  type GuideRegistry,
  type CommandRegistry,
  type ServiceRegistry,
  type VedanaRegistry,
  type MonitorRegistry,
  type CommChannelRegistry,
} from "../infrastructure/index.js";
import { createSecurityLayer, type SecurityLayer } from "../security/guardrails.js";
import { createSafetyMonitor, type SafetyMonitor } from "../security/safety-monitor.js";
import { createTransportBridge } from "../transport/bridge.js";
import { createMetricsCollector } from "../observability/index.js";
import type { MetricsCollector } from "../observability/index.js";
import { createPluginSandboxManager, type PluginSandboxManager } from "../sandbox/index.js";
import { createSignatureVerifier } from "../sandbox/signature-verification.js";
import { createGearArbiterRegistry } from "../mano/index.js";
import { createManoAggregator } from "../mano/index.js";
import { createVitakkaWatchdog } from "../vijnana/vitakka-watchdog.js";
import { createDefaultKleshas, KleshaModulatedDispatcher } from "../vijnana/klesha.js";
import type { IKlesha, KleshaContext } from "@openstarry/sdk";
import {
  DEFAULT_VITAKKA_WATCHDOG_CONFIG,
  DEFAULT_MANO_AGGREGATOR_CONFIG,
  DEFAULT_SAFETY_MONITOR_CONFIG,
  DEFAULT_CONFIDENCE_AUDIT_CONFIG,
  DEFAULT_EXECUTION_CONFIG,
  DEFAULT_KLESHA_FILTER_CONFIG,
  DEFAULT_KLESHA_MODULATION_CONFIG,
  DEFAULT_VEDANA_EMERGENCY_CONFIG,
} from "@openstarry/sdk";
import type { LoopQualityReport, SafetyMonitorConfig, ConfidenceAuditConfig, ManoAggregatorConfig, VitakkaWatchdogConfig, ExecutionConfig, KleshaFilterConfig, KleshaModulationConfig, VedanaEmergencyConfig } from "@openstarry/sdk";
import { createAuditTrailWriter } from "../observability/audit-trail-writer.js";

const logger = createLogger("AgentCore");

export function createVedanaFn(registry: VedanaRegistry): () => VedanaAssessment {
  const NEUTRAL: ChannelVedana = Object.freeze({
    valence: 0, intensity: 0, type: 'upekkha' as const, source: 'neutral',
  });
  const NEUTRAL_ASSESSMENT: VedanaAssessment = Object.freeze({
    aggregate: NEUTRAL, channels: [NEUTRAL], pidOutput: 0, timestamp: 0,
  });

  return (): VedanaAssessment => {
    const sensors = registry.list();
    if (sensors.length === 0) {
      return { ...NEUTRAL_ASSESSMENT, timestamp: Date.now() };
    }
    const channels: ChannelVedana[] = [];
    for (const sensor of sensors) {
      try {
        channels.push(sensor.sense(null));
      } catch (err) {
        logger.debug('Sensor error', { sensorId: sensor.id, error: err });
      }
    }
    if (channels.length === 0) {
      return { ...NEUTRAL_ASSESSMENT, timestamp: Date.now() };
    }
    const avgValence = channels.reduce((s, c) => s + c.valence, 0) / channels.length;
    const maxIntensity = Math.max(...channels.map(c => c.intensity));
    const type = classifyVedana(avgValence, DEFAULT_VEDANA_CONFIG);
    const aggregate: ChannelVedana = {
      valence: avgValence, intensity: maxIntensity, type, source: 'aggregate',
    };
    return {
      aggregate, channels, pidOutput: avgValence * maxIntensity, timestamp: Date.now(),
    };
  };
}

/**
 * Build a live klesha-signal getter from the four Plan26 perceivers.
 *
 * FIX-2026-06-11: until this wiring, `getKleshaSignals` was hardcoded to
 * neutral zeros at the volition-deps layer, so the klesha gain-scheduling
 * machinery (Doc 37) never modulated anything at runtime. Each call samples
 * the current vedana aggregate into a bounded history and runs all four
 * perceivers over (recentVedana, actionHistory). With an empty history the
 * perceivers emit their own neutral baselines — the documented
 * Optional-degraded behavior (Tenet #7 three-tier criticality), not a stub.
 *
 * Exported (like createVedanaFn above) so the wiring is unit-testable.
 */
export function createKleshaSignalFn(
  perceivers: readonly IKlesha[],
  vedanaFn: () => VedanaAssessment,
  actionHistory: readonly string[],
  historyCap = 20,
): (sessionId?: string) => KleshaSignalBundle {
  const recentVedana: ChannelVedana[] = [];
  return (sessionId?: string): KleshaSignalBundle => {
    const assessment = vedanaFn();
    recentVedana.push(assessment.aggregate);
    if (recentVedana.length > historyCap) recentVedana.shift();
    const context: KleshaContext = {
      ...(sessionId !== undefined ? { sessionId } : {}),
      recentVedana,
      actionHistory,
    };
    const bundle: Record<'moha' | 'drishti' | 'mana' | 'sneha', number> = {
      moha: 0, drishti: 0, mana: 0, sneha: 0,
    };
    for (const k of perceivers) {
      try {
        bundle[k.type] = k.perceive(context).value;
      } catch (err) {
        logger.debug('Klesha perceive error', { klesha: k.type, error: err });
      }
    }
    return bundle;
  };
}

/**
 * Build the θ(t) gain-scheduled base-threshold getter for gear arbitration
 * (TENET-2026-06-11 — Doc 37 closure; completes the Tenet #8 control loop).
 *
 * Plugs into createManoAggregator's `baseThresholdFn` slot (the purpose-built
 * dynamic-θ hook that had been passed `undefined` since Plan29). Each route()
 * call samples the SHARED kleshaSignalFn (one perceiver set, one vedana ring
 * buffer — never duplicate that state) and maps the bundle through
 * KleshaModulatedDispatcher.computeThreshold:
 *   θ(t) = clamp(θ₀ + w_sneha·μ_sneha + w_mana·μ_mana, θ_min, θ_max)
 *
 * NOTE: the dispatcher's perceiveAll() is deliberately NOT called here — it
 * would re-step the stateful filters (Moha EMA, Sneha integral); only the
 * pure computeThreshold half is exercised. Emits 'klesha:modulation' with the
 * bundle + resulting θ for observability.
 *
 * Exported (like createVedanaFn / createKleshaSignalFn above) for direct
 * unit-testing of the wiring.
 */
export function createKleshaThresholdFn(
  dispatcher: KleshaModulatedDispatcher,
  kleshaSignalFn: (sessionId?: string) => KleshaSignalBundle,
  bus?: EventBus,
): () => number {
  return (): number => {
    const bundle = kleshaSignalFn();
    const threshold = dispatcher.computeThreshold(bundle);
    bus?.emit({
      type: 'klesha:modulation',
      timestamp: Date.now(),
      payload: { ...bundle, threshold },
    });
    return threshold;
  };
}

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
  readonly commChannelRegistry: CommChannelRegistry;

  loadPlugin(plugin: IPlugin): Promise<void>;
  /** Load multiple plugins with dependency ordering (topological sort). */
  loadPlugins(plugins: IPlugin[]): Promise<void>;
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
  // Plan32 Wave 6: Context manager resolved from plugin in start() (REQUIRED)
  let contextManager: IContextManager | null = null;

  const toolRegistry = createToolRegistry();
  const providerRegistry = createProviderRegistry();
  const listenerRegistry = createListenerRegistry();
  const uiRegistry = createUIRegistry();
  const guideRegistry = createGuideRegistry();
  const commandRegistry = createCommandRegistry();
  const serviceRegistry = createServiceRegistry();
  const vedanaRegistry = createVedanaRegistry();
  const gearArbiterRegistry = createGearArbiterRegistry();
  const monitorRegistry = createMonitorRegistry();
  const commChannelRegistry = createCommChannelRegistry();

  // Plan32 Wave 3: Three-layer config resolution (SDK defaults + user overrides)
  const resolvedManoConfig: ManoAggregatorConfig = Object.freeze({
    ...DEFAULT_MANO_AGGREGATOR_CONFIG,
    ...config.mano,
  });
  const resolvedSafetyConfig: SafetyMonitorConfig = Object.freeze({
    ...DEFAULT_SAFETY_MONITOR_CONFIG,
    maxLoopTicks: config.policy?.maxConcurrentTools
      ? config.policy.maxConcurrentTools * 10
      : DEFAULT_SAFETY_MONITOR_CONFIG.maxLoopTicks,
    ...config.safety,
  });
  const resolvedConfidenceAuditConfig: ConfidenceAuditConfig = Object.freeze({
    ...DEFAULT_CONFIDENCE_AUDIT_CONFIG,
    ...config.confidenceAudit,
  });
  const resolvedVitakkaConfig: VitakkaWatchdogConfig = Object.freeze({
    ...DEFAULT_VITAKKA_WATCHDOG_CONFIG,
    ...config.vitakka,
  });

  // Plan32 Wave 4 (P1): Execution config resolution
  const resolvedExecutionConfig: ExecutionConfig = Object.freeze({
    ...DEFAULT_EXECUTION_CONFIG,
    // Layer 1 overrides from IAgentConfig (legacy fields + new execution block)
    ...(config.cognition.maxToolRounds != null ? { maxToolRounds: config.cognition.maxToolRounds } : {}),
    ...(config.memory?.slidingWindowSize != null ? { slidingWindowSize: config.memory.slidingWindowSize } : {}),
    ...(config.policy?.toolTimeout != null ? { toolTimeout: config.policy.toolTimeout } : {}),
    ...(config.policy?.llmTimeout != null ? { llmTimeout: config.policy.llmTimeout } : {}),
    ...config.execution,
  });

  // Plan32 Wave 4 (P1): Klesha filter config resolution
  const resolvedKleshaFilterConfig: KleshaFilterConfig = Object.freeze({
    moha: { ...DEFAULT_KLESHA_FILTER_CONFIG.moha, ...config.kleshaFilter?.moha },
    drishti: { ...DEFAULT_KLESHA_FILTER_CONFIG.drishti, ...config.kleshaFilter?.drishti },
    mana: { ...DEFAULT_KLESHA_FILTER_CONFIG.mana, ...config.kleshaFilter?.mana },
    sneha: { ...DEFAULT_KLESHA_FILTER_CONFIG.sneha, ...config.kleshaFilter?.sneha },
  });

  // FIX-2026-06-11: klesha perceivers consume resolvedKleshaFilterConfig
  // (computed since Plan32 W4 but previously fed to nothing). Action history
  // is collected from live tool:executing events; vedana history is sampled
  // per deliberation inside createKleshaSignalFn.
  const kleshaPerceivers = createDefaultKleshas(resolvedKleshaFilterConfig);
  const KLESHA_ACTION_HISTORY_CAP = 20;
  const kleshaActionHistory: string[] = [];
  bus.on('tool:executing', (event) => {
    const name = (event.payload as { name?: string } | undefined)?.name;
    if (!name) return;
    kleshaActionHistory.push(name);
    if (kleshaActionHistory.length > KLESHA_ACTION_HISTORY_CAP) kleshaActionHistory.shift();
  });

  // TENET-2026-06-11: ONE shared klesha signal source at factory scope.
  // Previously created inside start() under the volition branch only — a
  // second consumer (the threshold fn below) would have duplicated the
  // perceiver/vedana-history state. Both volition deliberation and gear
  // arbitration now read the same stream. Note the consequence: with both
  // consumers active the stateful filters advance at the combined call rate
  // (one consistent stream, different effective time-constants) — by design;
  // do NOT split into two perceiver sets.
  const vedanaFn = createVedanaFn(vedanaRegistry);
  const kleshaSignalFn = createKleshaSignalFn(kleshaPerceivers, vedanaFn, kleshaActionHistory);

  // TENET-2026-06-11 (Doc 37 closure): opt-in θ(t) modulation. Presence of
  // config.kleshaModulation (even {}) enables the dispatcher; absent keeps
  // the static mano baseThreshold — pre-v0.59 behavior byte-for-byte.
  // Unset bounds inherit the RESOLVED mano values (single source of truth);
  // explicit overrides win; weights default to the SDK constants (MR-6:
  // zero policy constants live in core).
  const resolvedKleshaModulationConfig: KleshaModulationConfig | null = config.kleshaModulation
    ? Object.freeze({
        baseThreshold: config.kleshaModulation.baseThreshold ?? resolvedManoConfig.baseThreshold,
        minThreshold: config.kleshaModulation.minThreshold ?? resolvedManoConfig.thresholdFloor,
        maxThreshold: config.kleshaModulation.maxThreshold ?? resolvedManoConfig.thresholdCeiling,
        weights: { ...DEFAULT_KLESHA_MODULATION_CONFIG.weights, ...config.kleshaModulation.weights },
      })
    : null;
  const kleshaDispatcher = resolvedKleshaModulationConfig
    ? new KleshaModulatedDispatcher([...kleshaPerceivers], resolvedKleshaModulationConfig)
    : null;
  const kleshaThresholdFn = kleshaDispatcher
    ? createKleshaThresholdFn(kleshaDispatcher, kleshaSignalFn, bus)
    : undefined;

  // GAP-2026-06-11 (T1b): VedanaEmergency wiring. createManoAggregator's
  // param-4 vedanaFn had been passed undefined since Plan28 R1, so the
  // sustained-dukkha thresholdBoost path (mano-aggregator.ts) was dead at
  // runtime, and config.vedanaEmergency was a third computed-but-unconsumed
  // config. The aggregator wants the aggregate ChannelVedana, sampled from
  // the same factory-scope vedanaFn the klesha stream uses.
  const resolvedVedanaEmergencyConfig: VedanaEmergencyConfig = Object.freeze({
    ...DEFAULT_VEDANA_EMERGENCY_CONFIG,
    ...config.vedanaEmergency,
  });
  const manoVedanaFn = (): ReturnType<typeof vedanaFn>["aggregate"] => vedanaFn().aggregate;

  // ManoAggregator created after plugin loading to wire auditor; use lazy init
  let _manoAggregator = createManoAggregator(
    bus, resolvedManoConfig, kleshaThresholdFn, manoVedanaFn, resolvedVedanaEmergencyConfig,
  );

  // VitakkaWatchdog — prevents samsaric stall (Plan27b)
  const watchdog = createVitakkaWatchdog(resolvedVitakkaConfig);
  bus.on('gear:switch', (event) => {
    const payload = event.payload as { gear?: number } | undefined;
    if (!payload?.gear) return;
    const gear = payload.gear;
    if (gear === resolvedManoConfig.defaultGear) {
      watchdog.resetOnDefaultGear();
    } else {
      const stalled = watchdog.recordGearCycle(gear);
      if (stalled) {
        bus.emit({
          type: 'vitakka:stall',
          timestamp: Date.now(),
          payload: { stalledGear: gear },
        });
        _manoAggregator.forceNextGear(resolvedManoConfig.defaultGear);
      }
    }
  });

  const security = createSecurityLayer(
    config.capabilities.allowedPaths ?? [config.identity.id],
    (sessionId?: string) => {
      if (!sessionId) return undefined;
      const session = sessionManager.get(sessionId);
      return session ? getSessionConfig(session.metadata) : undefined;
    },
  );

  const safetyMonitor = createSafetyMonitor(resolvedSafetyConfig, {
    maxTokenBudget: config.maxTokenBudget,
    confidenceFloor: config.confidenceFloor,
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
    vedanaRegistry,
    gearArbiterRegistry,
    monitorRegistry,
    commChannelRegistry,
    sandboxManager,
    bus,
    signatureVerifier: createSignatureVerifier(),
  });

  const bridge = createTransportBridge(bus, uiRegistry);
  let bridgeUnsub: (() => void) | null = null;
  let executionLoop: ExecutionLoop | null = null;
  let _auditTrailStop: (() => Promise<void>) | null = null;

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
    const cogSvc = serviceRegistry.get(SERVICE_KEYS.COGNITION_CONFIG);
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
    const cogSvc = serviceRegistry.get(SERVICE_KEYS.COGNITION_CONFIG);
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
    commChannelRegistry,

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

    async loadPlugins(plugins: IPlugin[]): Promise<void> {
      await pluginLoader.loadAll(plugins, (plugin) => {
        const pluginRef = config.plugins.find((p) => p.name === plugin.manifest.name);
        return getPluginContext(pluginRef?.config, plugin.manifest);
      });
      for (const plugin of plugins) {
        bus.emit({
          type: AgentEventType.PLUGIN_LOADED,
          timestamp: Date.now(),
          payload: { name: plugin.manifest.name },
        });
      }
    },

    async start(): Promise<void> {
      logger.info(`Starting agent: ${config.identity.name} (${config.identity.id})`);

      // Start transport bridge
      bridgeUnsub = bridge.start();

      // Plan32: Start all plugin-registered monitors
      monitorRegistry.startAll(bus);

      // Plan30: loopQualityFn callback for Layer 3
      const loopQualityFn = (): number => {
        const reports = monitorRegistry.list()
          .map(m => m.getReport())
          .filter((r): r is LoopQualityReport => r !== null);
        if (reports.length === 0) return 0;
        const stalenessMs = resolvedManoConfig.monitorStalenessMs!;
        const now = Date.now();
        const freshReports = reports.filter(r => now - r.timestamp <= stalenessMs);
        if (freshReports.length === 0) return 0;
        return freshReports.reduce((sum, r) => sum + r.score, 0) / freshReports.length;
      };

      // Recreate ManoAggregator with auditor + loopQualityFn (Plan29 + Plan30 + Plan31)
      // Plan32 Wave 1: No auto-mount — pluginAuditor may be undefined (delta=0)
      const pluginAuditor = pluginLoader.getAuditor();
      _manoAggregator = createManoAggregator(
        // TENET-2026-06-11: kleshaThresholdFn (param 3) closes the Doc 37
        // loop — vedana → perceivers → θ(t) → gear decision. undefined when
        // config.kleshaModulation is absent (static threshold, legacy path).
        // GAP-2026-06-11 (T1b): params 4+5 wire the VedanaEmergency
        // sustained-dukkha thresholdBoost (dead since Plan28 R1).
        bus, resolvedManoConfig, kleshaThresholdFn, manoVedanaFn, resolvedVedanaEmergencyConfig,
        pluginAuditor ?? undefined,   // null -> undefined; ManoAggregator handles this correctly
        loopQualityFn,
        resolvedConfidenceAuditConfig,
      );

      // Plan32 Wave 6: Resolve context manager from plugin (REQUIRED — no fallback)
      const resolvedCM = pluginLoader.getContextManager();
      if (!resolvedCM) {
        throw new Error(
          "No context manager plugin installed. " +
          "Install @openstarry-plugin/context-sliding-window or another IContextManager plugin. " +
          "Context management is required for agent operation."
        );
      }
      contextManager = resolvedCM;

      // Plan31 W3: Initialize audit trail JSONL writer
      const auditTrailConfig = config.auditTrail ?? { filePath: `./audit-trail-${config.identity.id}.jsonl` };
      if (auditTrailConfig.enabled !== false) {
        const auditTrailWriter = createAuditTrailWriter(bus, config.identity.id, auditTrailConfig);
        auditTrailWriter.start();
        // Store for cleanup in stop()
        _auditTrailStop = () => auditTrailWriter.stop();
      }

      // Plan28: Wire plugin-provided IVolition (if any) with klesha/vedana getters
      const pluginVolition = pluginLoader.getVolition();
      const volitionDeps = pluginVolition ? {
        deliberatePlan: pluginVolition.deliberatePlan.bind(pluginVolition),
        deliberateAction: pluginVolition.deliberateAction.bind(pluginVolition),
        // TENET-2026-06-11: reuses the ONE factory-scope kleshaSignalFn —
        // same perceiver set and vedana history as gear-threshold modulation.
        getKleshaSignals: kleshaSignalFn,
        getVedanaAssessment: vedanaFn,
      } : undefined;

      // Plan36b: Wire confirmation gate (if any)
      const pluginGate = pluginLoader.getConfirmationGate();
      const confirmationGateDeps = pluginGate ? {
        evaluate: pluginGate.evaluate.bind(pluginGate),
      } : undefined;

      // Create and start the execution loop
      executionLoop = createExecutionLoop({
        bus,
        queue,
        sessionManager,
        contextManager: contextManager!,  // guaranteed non-null by throw above
        toolRegistry,
        security,
        safetyMonitor,
        providerResolver: (sessionId?: string) => resolveProvider(sessionId),
        guideResolver: resolveGuide,
        modelResolver: (sessionId?: string) => resolveModel(sessionId),
        maxToolRounds: resolvedExecutionConfig.maxToolRounds,
        slidingWindowSize: resolvedExecutionConfig.slidingWindowSize,
        workingDirectory: process.cwd(),
        temperature: config.cognition.temperature,
        maxTokens: config.cognition.maxTokens,
        toolTimeout: resolvedExecutionConfig.toolTimeout,
        llmTimeout: resolvedExecutionConfig.llmTimeout,
        manoAggregator: _manoAggregator,
        gearArbiterRegistry,
        monitorRegistry,
        volition: volitionDeps,
        confirmationGate: confirmationGateDeps,
      });
      executionLoop.start();

      // Wire metrics auto-counters
      bus.on(AgentEventType.TOOL_EXECUTING, () => metrics.increment("tool.calls.total"));
      bus.on(AgentEventType.TOOL_ERROR, () => metrics.increment("tool.calls.errors"));
      bus.on(AgentEventType.PROVIDER_ERROR, () => metrics.increment("provider.calls.errors"));
      bus.on(AgentEventType.SESSION_CREATED, () => metrics.increment("session.created"));
      bus.on(AgentEventType.SESSION_DESTROYED, () => metrics.increment("session.destroyed"));

      // Start all listeners (色蘊 — sensory input)
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

      // Stop listeners (色蘊 — sensory input)
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

      // Plan32: Stop all monitors
      monitorRegistry.stopAll();

      // Plan31: Stop audit trail writer
      if (_auditTrailStop) {
        await _auditTrailStop();
        _auditTrailStop = null;
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
        void (async () => {
          try {
            const handled = await handleSlashCommand(inputEvent.data as string, inputEvent.sessionId);
            if (!handled) {
              // Not a known command — push to queue for LLM processing
              queue.push({
                type: AgentEventType.INPUT_RECEIVED,
                timestamp: Date.now(),
                payload: inputEvent,
              });
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error("Slash command error", { error: errMsg });
            process.exitCode = 1;
            bus.emit({
              type: AgentEventType.LOOP_ERROR,
              timestamp: Date.now(),
              payload: { error: `Slash command error: ${errMsg}`, fatal: true, sessionId: inputEvent.sessionId },
            });
            bus.emit({
              type: AgentEventType.MESSAGE_SYSTEM,
              timestamp: Date.now(),
              payload: { text: `Error: ${errMsg}`, sessionId: inputEvent.sessionId },
            });
          }
        })();
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

