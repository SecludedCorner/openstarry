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

// State & Memory
export { createStateManager } from "./state/index.js";
export { createContextManager } from "./memory/context.js";

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
} from "./infrastructure/index.js";
export type {
  ToolRegistry,
  ProviderRegistry,
  ListenerRegistry,
  UIRegistry,
  GuideRegistry,
  CommandRegistry,
  PluginLoader,
} from "./infrastructure/index.js";

// Sandbox
export { createPluginSandboxManager } from "./sandbox/index.js";
export type { PluginSandboxManager, SandboxManagerDeps } from "./sandbox/index.js";

// Security
export { createSecurityLayer } from "./security/guardrails.js";
export type { SecurityLayer } from "./security/guardrails.js";
export { createSafetyMonitor } from "./security/safety-monitor.js";
export type {
  SafetyMonitor,
  SafetyMonitorConfig,
  SafetyCheckResult,
} from "./security/safety-monitor.js";

// Transport
export { createTransportBridge } from "./transport/bridge.js";
export type { TransportBridge } from "./transport/bridge.js";

// Observability
export { createMetricsCollector } from "./observability/index.js";
export type { MetricsCollector, MetricsSnapshot } from "./observability/index.js";
