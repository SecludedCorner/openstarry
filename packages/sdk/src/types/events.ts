/**
 * Event system types and constants.
 * @skandha cross-cutting — EventBus is the nervous system connecting all five aggregates (五蘊)
 */

/** Handler function for events. */
export type EventHandler = (event: AgentEvent) => void | Promise<void>;

/** EventBus interface for pub/sub communication. */
export interface EventBus {
  on(type: string, handler: EventHandler): () => void;
  once(type: string, handler: EventHandler): () => void;
  onAny(handler: EventHandler): () => void;
  emit(event: AgentEvent): void;
}

/** A typed event emitted by the agent system. */
export interface AgentEvent {
  type: string;
  timestamp: number;
  payload?: unknown;
  /** Optional structured extras for cross-cutting observability data. Plan30. */
  extras?: Record<string, unknown>;
}

/** Standardized input event payload — all external inputs are normalized to this shape. */
export interface InputEvent {
  /** Source identifier (e.g. "cli", "webhook", "mcp") */
  source: string;
  /** Event subtype (e.g. "user_input", "system_command") */
  inputType: string;
  /** The actual data (usually a string for user input) */
  data: unknown;
  /** Reply channel identifier for routing output back */
  replyTo?: string;
  /** Session identifier for routing to isolated conversation state. */
  sessionId?: string;
  /**
   * Plan52 Candidate B ε-surface — plugin-attested source authentication context.
   *
   * **Opaque passthrough (CP-1)**: Core MUST NOT inspect, interpret, or branch on
   * any key inside `sourceContext`. The transport plugin attests; Core forwards.
   *
   * **Plugin-controlled shape (CP-3)**: structure is the plugin's contract;
   * `RecommendedSourceContextKeys` (SDK utility) is a SHOULD convention, not a
   * Core requirement.
   *
   * **Immutability (CP-4)**: SDK `deepFreeze` recursive applied at plugin emit
   * boundary; once received, downstream consumers MUST treat as frozen.
   *
   * @see packages/sdk/src/utils/pushinput-helpers.ts (RecommendedSourceContextKeys, deepFreeze)
   * @see openstarry_doc/Technical_Specifications/Plan52_pushInput_Binding.md §4
   */
  sourceContext?: Record<string, unknown>;
}

/** Core event type constants. */
export const AgentEventType = {
  // Lifecycle
  AGENT_STARTED: "agent:started",
  AGENT_STOPPED: "agent:stopped",

  // Execution loop
  LOOP_STARTED: "loop:started",
  LOOP_ASSEMBLING_CONTEXT: "loop:assembling_context",
  LOOP_AWAITING_LLM: "loop:awaiting_llm",
  LOOP_PROCESSING_RESPONSE: "loop:processing_response",
  LOOP_FINISHED: "loop:finished",
  LOOP_ERROR: "loop:error",

  // Messages
  MESSAGE_USER: "message:user",
  MESSAGE_ASSISTANT: "message:assistant",
  MESSAGE_SYSTEM: "message:system",

  // Streaming
  STREAM_TEXT_DELTA: "stream:text_delta",
  STREAM_REASONING_DELTA: "stream:reasoning_delta",
  STREAM_TOOL_CALL_START: "stream:tool_call_start",
  STREAM_TOOL_CALL_DELTA: "stream:tool_call_delta",
  STREAM_TOOL_CALL_END: "stream:tool_call_end",
  STREAM_FINISH: "stream:finish",
  STREAM_ERROR: "stream:error",

  // Tool execution
  TOOL_EXECUTING: "tool:executing",
  TOOL_RESULT: "tool:result",
  TOOL_ERROR: "tool:error",
  TOOL_BLOCKED: "tool:blocked",

  // Plugin lifecycle
  PLUGIN_LOADED: "plugin:loaded",
  PLUGIN_ERROR: "plugin:error",

  // Provider
  PROVIDER_LOGIN: "provider:login",
  PROVIDER_LOGOUT: "provider:logout",
  PROVIDER_ERROR: "provider:error",

  // External input
  INPUT_RECEIVED: "input:received",
  SLASH_COMMAND: "input:slash_command",

  // Safety
  SAFETY_LOCKOUT: "safety:lockout",
  SAFETY_WARNING: "safety:warning",

  // State
  STATE_RESET: "state:reset",
  STATE_SNAPSHOT: "state:snapshot",

  // Session lifecycle
  SESSION_CREATED: "session:created",
  SESSION_DESTROYED: "session:destroyed",

  // Metrics
  METRICS_SNAPSHOT: "metrics:snapshot",

  // MCP lifecycle
  MCP_SERVER_CONNECTED: "mcp:server_connected",
  MCP_SERVER_DISCONNECTED: "mcp:server_disconnected",
  MCP_TOOL_REGISTERED: "mcp:tool_registered",
  MCP_PROMPT_REGISTERED: "mcp:prompt_registered",

  // MCP server lifecycle (Cycle 4)
  MCP_CLIENT_CONNECTED: "mcp:client_connected",
  MCP_CLIENT_DISCONNECTED: "mcp:client_disconnected",

  // Sandbox lifecycle (Plan07)
  SANDBOX_WORKER_SPAWNED: "sandbox:worker_spawned",
  SANDBOX_WORKER_CRASHED: "sandbox:worker_crashed",
  SANDBOX_WORKER_SHUTDOWN: "sandbox:worker_shutdown",
  SANDBOX_MEMORY_LIMIT_EXCEEDED: "sandbox:memory_limit_exceeded",
  SANDBOX_SIGNATURE_VERIFIED: "sandbox:signature_verified",
  SANDBOX_SIGNATURE_FAILED: "sandbox:signature_failed",

  // Sandbox hardening (Plan07.1)
  SANDBOX_WORKER_STALLED: "sandbox:worker_stalled",
  SANDBOX_WORKER_RESTARTED: "sandbox:worker_restarted",
  SANDBOX_WORKER_RESTART_EXHAUSTED: "sandbox:worker_restart_exhausted",

  // Sandbox advanced hardening (Plan07.2)
  SANDBOX_IMPORT_BLOCKED: "sandbox:import_blocked",

  // Sandbox final hardening (Plan07.3)
  SANDBOX_MODULE_BLOCKED: "sandbox:module_blocked",
  SANDBOX_AUDIT_LOG_ROTATED: "sandbox:audit_log_rotated",
  SANDBOX_AUDIT_LOG_ERROR: "sandbox:audit_log_error",

  // ─── MCP Sampling Events (Cycle 17) ───
  /**
   * Emitted when MCP server requests LLM sampling from client.
   * Payload: { serverName: string, traceId: string, depth: number, messageCount: number }
   */
  MCP_SAMPLING_REQUEST: "mcp:sampling_request",

  /**
   * Emitted when sampling completes successfully.
   * Payload: { serverName: string, traceId: string, model: string, tokenCount: number }
   */
  MCP_SAMPLING_RESPONSE: "mcp:sampling_response",

  /**
   * Emitted when sampling depth limit exceeded (default: 5).
   * Payload: { serverName: string, traceId: string, depth: number, limit: number }
   */
  MCP_SAMPLING_DEPTH_LIMIT: "mcp:sampling_depth_limit",

  /**
   * Emitted when sampling fails (provider error, invalid params, etc.).
   * Payload: { serverName: string, traceId: string, error: string }
   */
  MCP_SAMPLING_ERROR: "mcp:sampling_error",

  // ─── MCP Logging Events (Cycle 17) ───
  /**
   * Emitted when MCP server sends a log notification to client.
   * Payload: { serverName: string, level: McpLogLevel, logger?: string, data: unknown }
   */
  MCP_SERVER_LOG: "mcp:server_log",

  /**
   * Emitted when client sends logging/setLevel to server.
   * Payload: { serverName: string, level: McpLogLevel }
   */
  MCP_LOG_LEVEL_CHANGED: "mcp:log_level_changed",

  // ─── MCP Roots Events (Cycle 17) ───
  /**
   * Emitted when MCP server requests roots list from client.
   * Payload: { serverName: string, rootCount: number }
   */
  MCP_ROOTS_REQUESTED: "mcp:roots_requested",

  /**
   * Emitted when client's roots configuration changes.
   * Payload: { sessionId: string, rootCount: number }
   */
  MCP_ROOTS_CHANGED: "mcp:roots_changed",

  // ─── Vedana Events (Plan26) ───
  /** Emitted when vedana assessment is computed. */
  VEDANA_ASSESSMENT: "vedana:assessment",
  /** Emitted when a single vedana channel updates. */
  VEDANA_CHANNEL_UPDATE: "vedana:channel_update",

  // ─── Volition Events (Plan26) ───
  /** Emitted after IVolition plan-level deliberation completes. */
  VOLITION_DELIBERATION: "volition:deliberation",
  /** Emitted when IVolition vetoes a specific action. */
  VOLITION_VETO: "volition:veto",

  // ─── CoarisingBundle Events (Plan26) ───
  /** Emitted when a new CoarisingBundle is assembled. */
  COARISING_BUNDLE: "coarising:bundle",

  // ─── Klesha Events (Plan26) ───
  /** Emitted when klesha signals are updated. */
  KLESHA_UPDATE: "klesha:update",

  // ─── Gear Routing Events (Plan27b → Plan30 constant promotion) ───
  /** Emitted when gear arbiter completes evaluation. */
  GEAR_ARBITER_EVALUATED: "gear:arbiter_evaluated",
  /** Emitted when gear switch occurs. */
  GEAR_SWITCH: "gear:switch",
  /** Emitted when VitakkaWatchdog detects a stall. */
  VITAKKA_STALL: "vitakka:stall",
  /** Emitted when action is proposed for execution. */
  ACTION_PROPOSED: "action:proposed",

  // ─── Loop Quality Events (Plan30) ───
  /** Emitted by ILoopQualityMonitor when a new quality report is ready. */
  LOOP_QUALITY_UPDATED: "loop:quality_updated",
  /** Emitted when confidence audit completes. */
  AUDIT_COMPLETED: "audit:completed",
  /** Emitted when plugin contributes extras to audit context. */
  AUDIT_CONTEXT_CONTRIBUTE: "audit:context_contribute",

  // ─── Confirmation Gate Events (Plan36b) ───
  /** Emitted when confirmation gate requests user input. */
  CONFIRMATION_REQUEST: "confirmation:request",
  /** Emitted by UI plugin with user's confirmation response. */
  CONFIRMATION_RESPONSE: "confirmation:response",
} as const;

export type AgentEventTypeValue = (typeof AgentEventType)[keyof typeof AgentEventType];

/**
 * Typed payload map for AgentEvent discriminated access.
 * Maps event type strings to their expected payload shapes.
 * Use with TypedAgentEvent<T> for type-safe event handling.
 */
export interface AgentEventPayloadMap {
  // Lifecycle
  [AgentEventType.AGENT_STARTED]: { identity: { id: string; name: string } };
  [AgentEventType.AGENT_STOPPED]: undefined;

  // Execution loop
  [AgentEventType.LOOP_STARTED]: { source: string; traceId: string; sessionId?: string; replyTo?: string };
  [AgentEventType.LOOP_ASSEMBLING_CONTEXT]: { round: number; sessionId?: string; replyTo?: string };
  [AgentEventType.LOOP_AWAITING_LLM]: { model: string; round: number; sessionId?: string; replyTo?: string };
  [AgentEventType.LOOP_PROCESSING_RESPONSE]: undefined;
  [AgentEventType.LOOP_FINISHED]: { traceId: string; sessionId?: string; replyTo?: string };
  [AgentEventType.LOOP_ERROR]: { error: string; fatal?: boolean; sessionId?: string; replyTo?: string };

  // Messages
  [AgentEventType.MESSAGE_USER]: { message: unknown; source: string; sessionId?: string; replyTo?: string };
  [AgentEventType.MESSAGE_ASSISTANT]: { message: unknown; sessionId?: string; replyTo?: string };
  [AgentEventType.MESSAGE_SYSTEM]: { text: string; sessionId?: string; replyTo?: string };

  // Streaming
  [AgentEventType.STREAM_TEXT_DELTA]: { text: string; sessionId?: string; replyTo?: string };
  [AgentEventType.STREAM_REASONING_DELTA]: { text: string; sessionId?: string; replyTo?: string };
  [AgentEventType.STREAM_TOOL_CALL_START]: { toolCallId: string; name: string; sessionId?: string; replyTo?: string };
  [AgentEventType.STREAM_TOOL_CALL_DELTA]: { toolCallId: string; input: string; sessionId?: string; replyTo?: string };
  [AgentEventType.STREAM_TOOL_CALL_END]: { toolCallId: string; name: string; input: string; sessionId?: string; replyTo?: string };
  [AgentEventType.STREAM_FINISH]: { stopReason: string; usage?: unknown; sessionId?: string; replyTo?: string };
  [AgentEventType.STREAM_ERROR]: { error: string; sessionId?: string; replyTo?: string };

  // Tool execution
  [AgentEventType.TOOL_EXECUTING]: { toolCallId: string; name: string; arguments: unknown; sessionId?: string; replyTo?: string };
  [AgentEventType.TOOL_RESULT]: { toolCallId: string; name: string; result: unknown; sessionId?: string; replyTo?: string };
  [AgentEventType.TOOL_ERROR]: { toolCallId: string; name: string; error: string; sessionId?: string; replyTo?: string };
  [AgentEventType.TOOL_BLOCKED]: { toolCallId: string; name: string; reason: string };

  // Plugin lifecycle
  [AgentEventType.PLUGIN_LOADED]: { name: string };
  [AgentEventType.PLUGIN_ERROR]: { name: string; error: string };

  // Provider
  [AgentEventType.PROVIDER_LOGIN]: { providerId: string };
  [AgentEventType.PROVIDER_LOGOUT]: { providerId: string };
  [AgentEventType.PROVIDER_ERROR]: { providerId: string; error: string };

  // External input
  [AgentEventType.INPUT_RECEIVED]: unknown;
  [AgentEventType.SLASH_COMMAND]: { command: string; args: string };

  // Safety
  [AgentEventType.SAFETY_LOCKOUT]: { error: string; sessionId?: string; replyTo?: string };
  [AgentEventType.SAFETY_WARNING]: { warning: string; sessionId?: string; replyTo?: string };

  // State
  [AgentEventType.STATE_RESET]: undefined;
  [AgentEventType.STATE_SNAPSHOT]: unknown;

  // Session lifecycle
  [AgentEventType.SESSION_CREATED]: { sessionId: string };
  [AgentEventType.SESSION_DESTROYED]: { sessionId: string };

  // Metrics
  [AgentEventType.METRICS_SNAPSHOT]: unknown;

  // Sandbox
  [AgentEventType.SANDBOX_WORKER_SPAWNED]: { pluginName: string; memoryLimitMb: number };
  [AgentEventType.SANDBOX_WORKER_CRASHED]: { pluginName: string; error: string };
  [AgentEventType.SANDBOX_WORKER_SHUTDOWN]: { pluginName: string };
  [AgentEventType.SANDBOX_MEMORY_LIMIT_EXCEEDED]: { pluginName: string; memoryLimitMb: number };
  [AgentEventType.SANDBOX_SIGNATURE_VERIFIED]: { pluginName: string };
  [AgentEventType.SANDBOX_SIGNATURE_FAILED]: { pluginName: string; error: string };
  [AgentEventType.SANDBOX_WORKER_STALLED]: { pluginName: string; elapsedMs: number; cpuTimeoutMs: number };
  [AgentEventType.SANDBOX_WORKER_RESTARTED]: { pluginName: string; attempt: number; backoffMs: number };
  [AgentEventType.SANDBOX_WORKER_RESTART_EXHAUSTED]: { pluginName: string; crashCount: number; maxRestarts?: number; error?: string };
  [AgentEventType.SANDBOX_IMPORT_BLOCKED]: { pluginName: string; error: string };
  [AgentEventType.SANDBOX_MODULE_BLOCKED]: { pluginName: string; module: string };
  [AgentEventType.SANDBOX_AUDIT_LOG_ROTATED]: { pluginName: string };
  [AgentEventType.SANDBOX_AUDIT_LOG_ERROR]: { pluginName: string; error: string };

  // MCP
  [AgentEventType.MCP_SERVER_CONNECTED]: { serverName: string };
  [AgentEventType.MCP_SERVER_DISCONNECTED]: { serverName: string };
  [AgentEventType.MCP_TOOL_REGISTERED]: { serverName: string; toolName: string };
  [AgentEventType.MCP_PROMPT_REGISTERED]: { serverName: string; promptName: string };
  [AgentEventType.MCP_CLIENT_CONNECTED]: { clientId: string };
  [AgentEventType.MCP_CLIENT_DISCONNECTED]: { clientId: string };
  [AgentEventType.MCP_SAMPLING_REQUEST]: { serverName: string; traceId: string; depth: number; messageCount: number };
  [AgentEventType.MCP_SAMPLING_RESPONSE]: { serverName: string; traceId: string; model: string; tokenCount: number };
  [AgentEventType.MCP_SAMPLING_DEPTH_LIMIT]: { serverName: string; traceId: string; depth: number; limit: number };
  [AgentEventType.MCP_SAMPLING_ERROR]: { serverName: string; traceId: string; error: string };
  [AgentEventType.MCP_SERVER_LOG]: { serverName: string; level: string; logger?: string; data: unknown };
  [AgentEventType.MCP_LOG_LEVEL_CHANGED]: { serverName: string; level: string };
  [AgentEventType.MCP_ROOTS_REQUESTED]: { serverName: string; rootCount: number };
  [AgentEventType.MCP_ROOTS_CHANGED]: { sessionId: string; rootCount: number };

  // Vedana (Plan26)
  [AgentEventType.VEDANA_ASSESSMENT]: { aggregate: unknown; channelCount: number; pidOutput: number; sessionId?: string };
  [AgentEventType.VEDANA_CHANNEL_UPDATE]: { channel: string; valence: number; intensity: number; type: string; sessionId?: string };

  // Volition (Plan26)
  [AgentEventType.VOLITION_DELIBERATION]: { reasoning: string; modified: boolean; sessionId?: string };
  [AgentEventType.VOLITION_VETO]: { action: string; reasoning: string; alternative: unknown; sessionId?: string };

  // CoarisingBundle (Plan26)
  [AgentEventType.COARISING_BUNDLE]: { layer: number; mode: string; timestamp: number; sessionId?: string };

  // Klesha (Plan26)
  [AgentEventType.KLESHA_UPDATE]: { moha: number; drishti: number; mana: number; sneha: number; sessionId?: string };

  // Gear routing (Plan27b → Plan30)
  [AgentEventType.GEAR_ARBITER_EVALUATED]: { arbiterId: string; action: number | 'abstain'; confidence: number; riskCategory?: string; reasoning?: string };
  [AgentEventType.GEAR_SWITCH]: { gear: number; decidedBy?: string; confidence?: number; reason?: string };
  [AgentEventType.VITAKKA_STALL]: { stalledGear: number };
  [AgentEventType.ACTION_PROPOSED]: { actionId: string; toolName: string };

  // Loop quality (Plan30)
  [AgentEventType.LOOP_QUALITY_UPDATED]: { monitorId: string; score: number; vector: { coherence: number; efficiency: number; convergence: number; stability: number }; timestamp: number };
  [AgentEventType.AUDIT_COMPLETED]: { inputConfidence: number; rawDelta: number; clampedDelta: number; wasClamped: boolean; reasoning: string; outputConfidence: number; result: 'adjusted' | 'unchanged' | 'error'; auditDurationMs: number };
  [AgentEventType.AUDIT_CONTEXT_CONTRIBUTE]: { key: string; value: unknown };
}

/**
 * Helper type for creating type-safe events.
 * Usage: TypedAgentEvent<"agent:started"> gives you { type: "agent:started"; timestamp: number; payload: { identity: ... } }
 */
export type TypedAgentEvent<T extends keyof AgentEventPayloadMap> = {
  type: T;
  timestamp: number;
  payload: AgentEventPayloadMap[T];
};

/**
 * Type-safe event handler.
 * Usage: TypedEventHandler<"agent:started"> gives you (event: TypedAgentEvent<"agent:started">) => void
 */
export type TypedEventHandler<T extends keyof AgentEventPayloadMap> =
  (event: TypedAgentEvent<T>) => void | Promise<void>;
