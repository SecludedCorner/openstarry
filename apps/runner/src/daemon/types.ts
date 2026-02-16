/**
 * Daemon types — All FROZEN interfaces from Architecture Spec.
 *
 * FROZEN: These interfaces must not be modified without Spec Addendum.
 */

/**
 * Options for spawning a daemon process.
 * FROZEN: Implementations must use exactly these fields.
 */
export interface DaemonSpawnOptions {
  /** Agent ID (used for PID/socket/log file naming) */
  agentId: string;

  /** Path to agent config file (absolute path) */
  configPath: string;

  /** Directory for daemon state (PID, socket, logs) */
  statePath: string;

  /** Custom log file path (optional, defaults to statePath/logs/{agentId}.log) */
  logFile?: string;

  /** Custom PID file path (optional, defaults to statePath/pids/{agentId}.pid) */
  pidFile?: string;

  /** Custom socket path (optional, defaults to statePath/sockets/{agentId}.sock) */
  socketPath?: string;

  /** Environment variables to pass to daemon */
  env?: Record<string, string>;
}

/**
 * Result of spawning a daemon.
 * FROZEN: Returned by launcher.spawnDaemon().
 */
export interface DaemonSpawnResult {
  /** Process ID of spawned daemon */
  pid: number;

  /** Agent ID */
  agentId: string;

  /** Path to PID file */
  pidFile: string;

  /** Path to socket file */
  socketPath: string;

  /** Path to log file */
  logFile: string;
}

/**
 * PID file management utilities.
 * FROZEN: All PID operations must use these methods.
 */
export interface PidManager {
  /** Write PID to file (creates parent directories if needed) */
  writePid(pidFile: string, pid: number): void;

  /** Read PID from file (returns null if file doesn't exist or invalid) */
  readPid(pidFile: string): number | null;

  /** Delete PID file */
  deletePid(pidFile: string): void;

  /** Check if process with given PID is running */
  isProcessRunning(pid: number): boolean;

  /** Clean up stale PID and socket files */
  cleanupStale(pidFile: string, socketPath: string): void;

  /** List all agent IDs with running daemons */
  listRunningAgents(pidsDir: string): Array<{ agentId: string; pid: number; pidFile: string }>;
}

/**
 * JSON-RPC request sent from CLI to daemon.
 * FROZEN: Protocol message format.
 */
export interface RPCRequest {
  /** Request ID (for matching response) */
  id: string | number;

  /** RPC method name */
  method: string;

  /** Method parameters (optional) */
  params?: unknown;
}

/**
 * JSON-RPC response sent from daemon to CLI.
 * FROZEN: Protocol message format.
 */
export interface RPCResponse {
  /** Request ID (matches RPCRequest.id) */
  id: string | number;

  /** Result payload (present on success) */
  result?: unknown;

  /** Error payload (present on failure) */
  error?: RPCError;
}

/**
 * RPC error structure.
 * FROZEN: Error format.
 */
export interface RPCError {
  /** Error code (negative integers, JSON-RPC 2.0 convention) */
  code: number;

  /** Human-readable error message */
  message: string;

  /** Additional error data (optional) */
  data?: unknown;
}

/**
 * Event notification from daemon to client (unidirectional).
 * FROZEN: Event message format.
 */
export interface RPCEvent {
  /** Event type */
  event: string;

  /** Event payload */
  data: unknown;
}

/**
 * IPC server (runs inside daemon process).
 * FROZEN: Server must implement all methods.
 */
export interface IPCServer {
  /** Start server and listen on Unix domain socket */
  start(): Promise<void>;

  /** Stop server and cleanup socket file */
  stop(): Promise<void>;

  /** Broadcast event to all connected clients */
  broadcast(event: RPCEvent): void;
}

/**
 * IPC server options.
 * FROZEN: Constructor parameters.
 */
export interface IPCServerOptions {
  /** Path to Unix domain socket */
  socketPath: string;

  /** RPC request handler (async) - receives request and client socket */
  onRequest: (req: RPCRequest, socket: import("node:net").Socket) => Promise<unknown>;
}

/**
 * IPC client (used by CLI commands).
 * FROZEN: Client must implement all methods.
 */
export interface IPCClient {
  /** Connect to daemon socket */
  connect(): Promise<void>;

  /** Send RPC request and wait for response */
  call(method: string, params?: unknown): Promise<unknown>;

  /** Close connection */
  close(): void;

  /** Listen for events from daemon */
  on(event: string, handler: (data: unknown) => void): void;
}

/**
 * IPC client options.
 * FROZEN: Constructor parameters.
 */
export interface IPCClientOptions {
  /** Path to Unix domain socket */
  socketPath: string;

  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
}

/**
 * Agent status information returned by RPC methods.
 * FROZEN: Status object structure.
 */
export interface AgentStatus {
  /** Agent ID */
  agentId: string;

  /** Process ID */
  pid: number;

  /** Daemon status */
  status: 'running' | 'stopped' | 'unknown';

  /** Uptime in seconds (0 if stopped) */
  uptime: number;

  /** Path to config file */
  configPath: string;

  /** Path to log file */
  logFile: string;

  /** Socket path */
  socketPath: string;
}

/**
 * Options for attaching to a running daemon.
 * FROZEN: Attach command parameters.
 */
export interface AttachOptions {
  /** Session ID to attach to (optional, creates new if not provided) */
  sessionId?: string;

  /** Interface mode (reserved for future use) */
  interface?: string;
}

/**
 * Result of attaching to a daemon session.
 * FROZEN: Returned by agent.attach RPC.
 */
export interface AttachResult {
  /** Session ID (existing or newly created) */
  sessionId: string;

  /** Whether this is a new session (true) or existing (false) */
  isNew: boolean;

  /** Agent ID */
  agentId: string;

  /** Agent name */
  agentName: string;

  /** Agent version */
  agentVersion: string;
}

/**
 * Input message to send to daemon session.
 * FROZEN: Format for agent.input RPC.
 */
export interface InputMessage {
  /** Session ID to send input to */
  sessionId: string;

  /** Input type (e.g., "user_input", "system_command") */
  inputType: string;

  /** Input data (typically string for user input) */
  data: unknown;
}

/**
 * Detach message to unsubscribe from session events.
 * FROZEN: Format for agent.detach RPC.
 */
export interface DetachMessage {
  /** Session ID to detach from */
  sessionId: string;
}

/**
 * Session subscription tracking (internal).
 */
export interface SessionSubscription {
  /** Session ID */
  sessionId: string;

  /** Client socket */
  socket: import("node:net").Socket;
}

/**
 * RPC error codes
 */
export const RPCErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  AGENT_NOT_FOUND: -32001,
  AGENT_ALREADY_RUNNING: -32002,
} as const;

/**
 * Client information for monitoring (agent.list-clients).
 */
export interface ClientInfo {
  clientId: string;
  attachedAt: number;
  sessionId: string | null;
}

/**
 * Result of agent.list-clients RPC method.
 */
export interface ListClientsResult {
  clients: ClientInfo[];
}
