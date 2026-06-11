// Agent Core
export { createAgentCore } from "./agents/agent-core.js";
export type { AgentCore } from "./agents/agent-core.js";

// EventBus
export { createEventBus } from "./bus/index.js";

// Execution
export { createEventQueue } from "./execution/queue.js";
export type { EventQueue } from "./execution/queue.js";
export { createExecutionLoop } from "./execution/loop.js";
export type { ExecutionLoop, LoopState, ExecutionLoopDeps } from "./execution/loop.js";

// State
export { createStateManager } from "./state/index.js";

// Session
export { createSessionManager } from "./session/manager.js";

// Infrastructure
export {
  createToolRegistry,
  createProviderRegistry,
  createListenerRegistry,
  createUIRegistry,
  createGuideRegistry,
  createCommandRegistry,
  createPluginLoader,
  createVedanaRegistry,
} from "./infrastructure/index.js";
export type {
  ToolRegistry,
  ProviderRegistry,
  ListenerRegistry,
  UIRegistry,
  GuideRegistry,
  CommandRegistry,
  PluginLoader,
  VedanaRegistry,
} from "./infrastructure/index.js";

// Sandbox
export { createPluginSandboxManager } from "./sandbox/index.js";
export type { PluginSandboxManager, SandboxManagerDeps } from "./sandbox/index.js";

// Security
export { createSecurityLayer, isPathSafe } from "./security/guardrails.js";
export type { SecurityLayer } from "./security/guardrails.js";
export { createSafetyMonitor } from "./security/safety-monitor.js";
export type {
  SafetyMonitor,
  SafetyCheckResult,
} from "./security/safety-monitor.js";

// Transport
export { createTransportBridge } from "./transport/bridge.js";
export type { TransportBridge } from "./transport/bridge.js";

// Observability
export { createMetricsCollector } from "./observability/index.js";
export type { MetricsCollector, MetricsSnapshot } from "./observability/index.js";

// Vedana — 受蘊 (Plan26)
export { createCoarisingBundle, isSahajaValid } from "./vedana/coarising-factory.js";
export type { CoarisingBundleInput } from "./vedana/coarising-factory.js";

// Vijnana — 識蘊 (Plan26 + Plan27)
export { Moha, Drishti, Mana, Sneha, KleshaModulatedDispatcher, createDefaultKleshas } from "./vijnana/klesha.js";
export type { SnehaConfig } from "./vijnana/klesha.js";
export { createVitakkaWatchdog } from "./vijnana/vitakka-watchdog.js";
export type { VitakkaWatchdog, VitakkaWatchdogState } from "./vijnana/vitakka-watchdog.js";
export { computeAdjustedThreshold, inferRiskCategory, DEFAULT_RISK_DELTA } from "./vijnana/klesha-threshold.js";
export type { RiskCategory, RiskDeltaConfig } from "./vijnana/klesha-threshold.js";

// Mano — 意處 gear routing (Plan27)
export { createGearArbiterRegistry } from "./mano/index.js";
export type { GearArbiterRegistry } from "./mano/index.js";
export { createManoAggregator } from "./mano/index.js";
export type { ManoAggregator } from "./mano/index.js";

// Plan33: Skandha correspondence check (18 sigma-constraints)
export { checkSkandhaCorrespondence } from "./infrastructure/skandha-check.js";
export type { SkandhaViolation } from "./infrastructure/skandha-check.js";

// Plan32: Built-in plugins extracted to @openstarry-plugin/* packages
