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
  IToolMetadata,
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
  PluginCriticality,
  PluginSnapshot,
} from "./types/plugin.js";

export type {
  IListener,
  SenseType,
  ITypedListener,
  IVisualListener,
  IAuditoryListener,
  IOlfactoryListener,
  IGustatoryListener,
  ITactileListener,
  AnyListener,
} from "./types/listener.js";
export type { IUI } from "./types/ui.js";
export type { IGuide, IPersistentGuide, CognitiveDirective } from "./types/guide.js";

// Confirmation Gate — 行蘊 T3 pre-execution confirmation (Plan36b)
export type {
  IConfirmationGate,
  ConfirmationRequest,
  ConfirmationDecision,
  UserConfirmationResponse,
  ConfirmationGateConfig,
} from "./types/confirmation-gate.js";
export { DEFAULT_CONFIRMATION_GATE_CONFIG } from "./types/confirmation-gate.js";
export type { IPluginService, IServiceRegistry } from "./types/service.js";
export { ServiceKey, SERVICE_KEYS } from "./types/service.js";
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
  AuditTrailConfig,
  ICommConfig,
  SupervisorStrategy,
  CompositeAgentPermissionLattice,
  ICompositeAgent,
  SpawnConstraints,
  IPermissionLattice,
} from "./types/agent.js";

export type {
  EventHandler,
  EventBus,
  AgentEvent,
  AgentEventTypeValue,
  InputEvent,
  AgentEventPayloadMap,
  TypedAgentEvent,
  TypedEventHandler,
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

// F-16 StructuredError — ENG-FAB v1.9 candidate (cycle 03-14, SHOULD initial)
export type {
  StructuredError,
  StructuredErrorCodeValue,
  LikelyCausePrefixValue,
} from "./errors/structured-error.js";
export {
  StructuredErrorCode,
  LikelyCausePrefix,
  LIKELY_CAUSE_UNKNOWN,
  SUGGESTED_FIX_LOCATION_UNKNOWN,
  STRUCTURED_ERROR_MESSAGE_MAX_LENGTH,
  normalizeErrorCode,
  validateLikelyCausePrefix,
  formatLikelyCause,
  buildStructuredError,
} from "./errors/structured-error.js";

// Plan50 σ_regime — closed enum + observation (cycle 03-13 binding + cycle 03-14 R3 refinement)
export type {
  SigmaRegime,
  SigmaObservation,
  InputSource,
} from "./types/sigma-regime.js";

// Plan52 pushInput Candidate B — SDK helpers (CR-SCK + signed-token + nonce cache)
export type {
  RecommendedSourceContextKey,
  ResolvedKey,
  KeyResolver,
} from "./utils/pushinput-helpers.js";
export {
  RecommendedSourceContextKeys,
  deepFreeze,
  NonceCache,
  computeCapabilityHash,
  buildCanonicalInput,
  formatTokenSig,
  parseTokenSig,
} from "./utils/pushinput-helpers.js";

// Plan54 AC-9 Sub-Agent Composition (cycle 03-16 BINDING; cycle 03-17 implementation)
export type {
  LifecycleState,
  LifecycleHookEvent,
  LifecycleEvent,
  LifecycleHandler,
  SpawnChildRequest,
  SpawnChildResponse,
} from "./types/agent-composition.js";
export {
  LIFECYCLE_STATES,
  LIFECYCLE_HOOK_EVENTS,
  LifecycleStateSchema,
  SpawnChildRequestSchema,
  SpawnChildResponseSchema,
} from "./types/agent-composition.js";

// Plan56 D-30-4 Multi-IVolition (cycle 03-18 BINDING)
export type {
  VolitionCategory,
  VolitionRequest,
  VolitionEmitResult,
  CognitiveMomentContext,
} from "./types/multi-ivolition.js";
export {
  VOLITION_CATEGORIES,
  VolitionCategorySchema,
  VolitionRequestSchema,
  VolitionEmitResultSchema,
} from "./types/multi-ivolition.js";

// Cycle 03-19 γ retrofit canonical redaction helpers
export {
  redactPayload,
  isRedactedFormat as isRedactedPayload,
} from "./utils/redaction.js";

// Plan57 D-30-5 VasanaEngine (cycle 03-19 BINDING)
export type {
  VasanaCategory,
  VasanaSensitivity,
  VasanaDepositEntry,
  VasanaDepositRequest,
  VasanaDepositResult,
} from "./types/vasana-engine.js";
export {
  VASANA_CATEGORIES,
  VASANA_SENSITIVITY,
  VASANA_GENESIS_PREV_HASH,
  VASANA_REPLAY_CACHE_PREFIX,
  VasanaCategorySchema,
  VasanaDepositEntrySchema,
  VasanaDepositRequestSchema,
  VasanaDepositResultSchema,
} from "./types/vasana-engine.js";

// Plan58 Mesh (cycle 03-21 BINDING; Phase 6 第五棒)
export type {
  MeshRoutingRule,
  MeshMessage,
  MeshPublishResult,
} from "./types/mesh.js";
export {
  MESH_REPLAY_CACHE_PREFIX,
  MeshRoutingRuleSchema,
  MeshMessageSchema,
  MeshPublishResultSchema,
} from "./types/mesh.js";

// Plan59 API Runtime (cycle 03-22 BINDING; Phase 6 第六棒; 識蘊 Vijnana)
export type {
  InterventionKind,
  InterventionPayload,
  LogLevel,
  ApiRuntimeInvokeRequest,
  ApiRuntimeInvokeResult,
  ApiRuntimeObserveScope,
  ApiRuntimeObserveResult,
  PluginRuntimeStateView,
} from "./types/api-runtime.js";
export {
  API_RUNTIME_REPLAY_CACHE_PREFIX,
  INTERVENTION_KINDS,
  LOG_LEVELS,
  InterventionPayloadSchema,
  ApiRuntimeInvokeRequestSchema,
  ApiRuntimeInvokeResultSchema,
  ApiRuntimeObserveScopeSchema,
  ApiRuntimeObserveResultSchema,
  PluginRuntimeStateViewSchema,
} from "./types/api-runtime.js";

// Plan60 Blackboard-Alaya (cycle 03-23 BINDING; Phase 6 7/7 完工 ✅; 識蘊 第八識 阿賴耶識)
export type {
  AlayaSeedDepositRequest,
  AlayaSeedDepositResult,
} from "./types/blackboard-alaya.js";
export {
  ALAYA_REPLAY_CACHE_PREFIX,
  AlayaSeedDepositRequestSchema,
  AlayaSeedDepositResultSchema,
} from "./types/blackboard-alaya.js";

// Session
export type { ISession, ISessionManager, SessionConfig } from "./types/session.js";
export { getSessionConfig, setSessionConfig } from "./types/session.js";

// Five Aggregates Root Interfaces (Plan25: Sanskrit renaming)
export type { IRupa, IVedana, ISamjna, ISamskara, IVijnana, Skandha } from "./types/aggregates.js";
export { isSkandha, hasSkandha } from "./types/aggregates.js";

// Vedana — 受蘊 measurement (Plan26 + Plan27 + Plan28)
export type {
  ChannelVedana,
  VedanaType,
  VedanaClassificationConfig,
  VedanaAssessment,
  VedanaTag,
  IVedanaSensor,
  VedanaDimension,
  VedanaSensorConfig,
  VedanaEmergencyConfig,
} from "./types/vedana.js";
export { classifyVedana, DEFAULT_VEDANA_CONFIG, DEFAULT_VEDANA_SENSOR_CONFIG, DEFAULT_VEDANA_EMERGENCY_CONFIG, toVedanaDimension, validateVedanaConfig } from "./types/vedana.js";

// Klesha — 煩惱 framework (Plan26 + Plan28)
export type {
  KleshaType,
  KleshaSignal,
  KleshaSignalBundle,
  KleshaDistribution,
  KleshaContext,
  IKlesha,
  KleshaModulationConfig,
  VitakkaWatchdogConfig,
  MohaConfig,
  MohaFilterConfig,
  DrishtiFilterConfig,
  ManaFilterConfig,
  SnehaFilterConfig,
  KleshaFilterConfig,
} from "./types/klesha.js";
export { DEFAULT_KLESHA_MODULATION_CONFIG, DEFAULT_VITAKKA_WATCHDOG_CONFIG, DEFAULT_MOHA_CONFIG, DEFAULT_KLESHA_FILTER_CONFIG } from "./types/klesha.js";

// Volition — 思/Cetana two-phase deliberation (Plan26 + Plan28)
export type {
  ToolCallInfo,
  DeliberationContext,
  PlanDeliberationInput,
  PlanDeliberationResult,
  ActionDeliberationInput,
  ActionDeliberationResult,
  IVolition,
} from "./types/volition.js";

// CoarisingBundle — 五遍行 (Plan26 + Plan27)
export type {
  SparshEvent,
  ChannelSamjna,
  ChannelCetana,
  ChannelManasikara,
  ManasikaraDimension,
  SahajaContract,
  CoarisingBundle,
} from "./types/coarising.js";
export { fromChannelManasikara, DEFAULT_STALENESS_BOUND_MS } from "./types/coarising.js";

// GearArbiter — 識蘊 gear routing (Plan27)
export type {
  IGearArbiter,
  GearContext,
  GearEvaluation,
  GearAction,
  GearToolCall,
  ActionRecord,
  AgentConfig,
  RouteResult,
  RiskCategory,
  RiskDeltaConfig,
  ManoAggregatorConfig,
} from "./types/gear-arbiter.js";
export {
  isGearArbiter,
  computeAdjustedThreshold,
  inferRiskCategory,
  DEFAULT_RISK_DELTA,
  DEFAULT_MANO_AGGREGATOR_CONFIG,
  TOOL_CONFIDENCE_TABLE,
} from "./types/gear-arbiter.js";

// AuditContext — 識蘊 audit context (Plan31)
export type { AuditContext } from "./types/audit-context.js";

// ConfidenceAuditor — 識蘊 confidence audit (Plan29 + Plan32)
export type {
  IConfidenceAuditor,
  ConfidenceAuditResult,
  ConfidenceAuditConfig,
} from "./types/confidence-auditor.js";
export { DEFAULT_CONFIDENCE_AUDIT_CONFIG } from "./types/confidence-auditor.js";

// Safety monitor — Plan32 Wave 3 + Plan33 postRouteCheck v2 defaults
export type { SafetyMonitorConfig } from "./types/safety.js";
export {
  DEFAULT_SAFETY_MONITOR_CONFIG,
  DEFAULT_POST_ROUTE_MAX_TOKEN_BUDGET,
  DEFAULT_POST_ROUTE_CONFIDENCE_FLOOR,
} from "./types/safety.js";

// Execution config — Plan32 Wave 4 (P1)
export type { ExecutionConfig } from "./types/execution.js";
export { DEFAULT_EXECUTION_CONFIG } from "./types/execution.js";

// Sandbox defaults — Plan32 Wave 4 (P2)
export type {
  SandboxManagerConfig,
  AuditLoggerConfig,
  AuditTrailWriterConfig,
  SandboxRpcConfig,
  WorkerPoolResetConfig,
} from "./types/sandbox-defaults.js";
export {
  DEFAULT_SANDBOX_MANAGER_CONFIG,
  DEFAULT_AUDIT_LOGGER_CONFIG,
  DEFAULT_AUDIT_TRAIL_WRITER_CONFIG,
  DEFAULT_SANDBOX_RPC_CONFIG,
  DEFAULT_WORKER_POOL_RESET_CONFIG,
} from "./types/sandbox-defaults.js";

// ConfidenceAuditLog — 識蘊 audit log type (Plan30) + AuditTrailEntryV2 discriminated union (Plan39 W0)
export type {
  ConfidenceAuditLog,
  AuditTrailEntryBase,
  ConfidenceAuditEntry,
  ToolAuditEntry,
  SeedExchangeAuditEntry,
  AuditTrailEntryV2,
} from "./types/confidence-audit-log.js";
export { MAX_AUDIT_REASONING_LENGTH } from "./types/confidence-audit-log.js";

// LoopQualityMonitor — 識蘊 loop quality monitoring (Plan29)
export type {
  ILoopQualityMonitor,
  LoopQualityVector,
  LoopQualityReport,
  LoopQualityWeights,
} from "./types/loop-quality-monitor.js";
export { DEFAULT_LOOP_QUALITY_WEIGHTS } from "./types/loop-quality-monitor.js";
export { MINIMAL_QUALITY_EVENTS } from "./types/loop-quality-monitor.js";
export type { MinimalQualityEvent } from "./types/loop-quality-monitor.js";

// Extras SDK helpers (Plan30)
export {
  isValidExtrasKey,
  getExtra,
  emitWithExtras,
  EXTRAS_MAX_KEYS,
  EXTRAS_MAX_KEY_LENGTH,
  EXTRAS_FORBIDDEN_PREFIXES,
} from "./utils/extras.js";

// Interfaces
export type { IContextManager } from "./interfaces/context.js";
export type { IStateManager } from "./interfaces/state.js";

// Context defaults — Plan35 W1 (context-summary plugin)
export { DEFAULT_CONTEXT_SUMMARY_PRESERVE_RATIO, DEFAULT_SUMMARY_PROMPT, DEFAULT_MIN_COMPRESS_TOKENS } from "./types/context.js";

// Project-level config types (Plan34)
export type {
  IProjectConfig,
  IProjectPermissions,
  IProjectPlugins,
  IProjectPluginRef,
  IProjectContext,
} from "./types/project.js";

// Agent registry types — Plan38 W1, Plan39 W3 + W4
export type {
  AgentHealthState,
  IAgentRegistryEntry,
  AgentSummary,
  AgentDetailedStatus,
  RegisterAgentResponse,
  ChannelProcessState,
  BroadcastResult,
  // W3 PROVISIONAL
  RegistryEventType,
  RegistryEvent,
  IRegistryEventBus,
  ReadySignal,
  // W4 FROZEN
  ChannelGuardError,
  WithChannelGuard,
} from "./types/agent-registry.js";

// Multi-agent communication — Plan37 W2
export type {
  ICommChannel,
  ICommChannelRegistry,
  CommCapability,
  CommChannelStatus,
  CommTopology,
  CommPerformative,
  CommMessage,
  CommMessageHandler,
} from "./types/comm-channel.js";
export { CommCapabilityError } from "./types/comm-channel.js";

// MCP transport interface — Plan37 C15
export type {
  IMcpTransport,
  McpServerEndpoint,
  McpClientConnection,
} from "./types/mcp-transport.js";

// Comm-proxy types — Plan38 C10, Plan39 W2
export type {
  CircuitBreakerState,
  CircuitBreakerConfig,
  BulkheadConfig,
  TimeoutHierarchyConfig,
  CommProxyConfig,
  ICommProxy,
  BulkheadType,
  CommMethodResult,
  CommProxyError,
  ICommProxyMethod,
} from "./types/comm-proxy.js";

// AC-7 DistributedAlaya interface — Plan38 C14, Plan39 W0 + W1, Plan41 W4
export type {
  IDistributedAlaya,
  ISeed,
  SeedFilter,
  SeedScope,
  SeedVisibility,
  SeedCallback,
  SeedPropagationEvent,
  ExchangeResult,
  SeedPatch,
  VectorClock,
  IBijaStore,
  ISeedSignatureService,
  SeedPropagationRequest,
  IAlayaSnapshot,
} from "./types/distributed-alaya.js";

// Communication errors — Plan38
export {
  SpawnDeniedError,
  CircuitBreakerError,
  BulkheadRejectError,
  RateLimitError,
} from "./errors/comm.js";
export type { SpawnDeniedReason } from "./errors/comm.js";

// CommRouter — Plan38 C7
export { routeMessage } from "./utils/comm-router.js";
export type { CommRouteDecision, AgentLookupFn } from "./utils/comm-router.js";

// Dual rate limiter types — Plan38 W5
export type { IDualRateLimiter, TokenBucket } from "./types/rate-limiter.js";

// SDK constants — Plan37 W2 (FROZEN) + Plan38 additions
export {
  COMPOSITE_AGENT_MAX_DEPTH,
  COMPOSITE_AGENT_DEFAULT_RESERVE_RATIO,
  DEFAULT_SUPERVISOR_STRATEGY,
  MAX_TRACE_DEPTH,
  DEFAULT_AGENT_GRACE_PERIOD_MS,
  MAX_AGENT_GRACE_PERIOD_MS,
  // Plan38 W1
  DEFAULT_CHANNEL_READY_TIMEOUT_MS,
  MAX_CHANNEL_READY_TIMEOUT_MS,
  DEFAULT_CHANNEL_HEARTBEAT_INTERVAL_MS,
  DEFAULT_CHANNEL_GRACE_PERIOD_MS,
  MAX_CHANNEL_GRACE_PERIOD_MS,
  DEFAULT_HEARTBEAT_MISS_THRESHOLD,
  // Plan38 W2
  DEFAULT_CB_FAILURE_THRESHOLD,
  DEFAULT_CB_COOLDOWN_MS,
  DEFAULT_CB_MONITOR_WINDOW_MS,
  DEFAULT_BULKHEAD_MAX_CONCURRENT,
  DEFAULT_BULKHEAD_MAX_QUEUE,
  DEFAULT_MESSAGE_TIMEOUT_MS,
  // Plan38 W3
  MAX_COMM_METADATA_ENTRIES,
  MAX_COMM_METADATA_VALUE_SIZE,
  // Plan38 W5
  DEFAULT_RATE_LIMIT_PER_AGENT,
  DEFAULT_RATE_LIMIT_PER_TARGET,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
} from "./constants.js";
