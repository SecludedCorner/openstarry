/**
 * Event system types and constants.
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
} as const;

export type AgentEventTypeValue = (typeof AgentEventType)[keyof typeof AgentEventType];
