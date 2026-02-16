// Types
export type {
  MessageRole,
  ToolCallRequest,
  ToolCallResult,
  ContentSegment,
  Message,
  ProviderStreamEvent,
  TokenUsage,
} from "./types/message.js";

export type {
  ITool,
  ToolContext,
  ToolJsonSchema,
} from "./types/tool.js";

export type {
  IProvider,
  IAgentContext,
  ChatRequest,
  ModelInfo,
  LoginHint,
} from "./types/provider.js";

export type {
  IPlugin,
  IPluginContext,
  PluginManifest,
  PluginHooks,
  SlashCommand,
  SandboxConfig,
  SandboxAuditConfig,
  AuditLogEntry,
  WorkerRestartPolicy,
  PkiIntegrity,
  PluginCapabilities,
} from "./types/plugin.js";

export type { IListener } from "./types/listener.js";
export type { IUI } from "./types/ui.js";
export type { IGuide } from "./types/guide.js";
export type { IPluginService, IServiceRegistry } from "./types/service.js";
export type { ICognitionConfigService } from "./types/cognition.js";

export type {
  IInferenceProvider,
  InferenceRequest,
  InferenceResult,
  InferenceInput,
  InferenceOutput,
  ClassificationLabel,
  DetectedObject,
} from "./types/inference.js";

export { isInferenceProvider } from "./types/inference.js";

export type {
  AgentIdentity,
  CognitionConfig,
  CapabilitiesConfig,
  PolicyConfig,
  MemoryConfig,
  IAgentConfig,
  PluginRef,
} from "./types/agent.js";

export type {
  EventHandler,
  EventBus,
  AgentEvent,
  AgentEventTypeValue,
  InputEvent,
} from "./types/events.js";

export { AgentEventType } from "./types/events.js";

// Errors
export {
  AgentError,
  ToolExecutionError,
  ProviderError,
  PluginLoadError,
  SecurityError,
  SandboxError,
  TransportError,
  SessionError,
  ConfigError,
  McpError,
  ServiceRegistrationError,
  ServiceDependencyError,
} from "./errors/base.js";

export { ErrorCode } from "./errors/codes.js";
export type { ErrorCodeValue } from "./errors/codes.js";

// Session
export type { ISession, ISessionManager, SessionConfig } from "./types/session.js";
export { getSessionConfig, setSessionConfig } from "./types/session.js";

// Interfaces
export type { IContextManager } from "./interfaces/context.js";
export type { IStateManager } from "./interfaces/state.js";
