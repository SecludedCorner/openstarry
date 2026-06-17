/**
 * Daemon types — All FROZEN interfaces from Architecture Spec.
 *
 * FROZEN: These interfaces must not be modified without Spec Addendum.
 */

import type { SessionIndexEntry } from "./session-persistence.js";

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

// -----------------------------------------------------------------------
// Plan37 C8: Process Tree types
// FROZEN: Spec Addendum (2026-03-24, Cycle 20260324_cycle03-1).
// -----------------------------------------------------------------------

/**
 * Configuration for spawning a child agent.
 * A subset of DaemonSpawnOptions — parentId is supplied separately as a
 * parameter to spawnChildAgent(), not embedded in config.
 *
 * FROZEN: Spec Addendum (2026-03-24, Cycle 20260324_cycle03-1).
 */
export interface ChildAgentSpawnConfig {
  agentId: string;
  configPath: string;
  statePath: string;
  env?: Record<string, string>;
}

/**
 * Agent lifecycle states including graceful shutdown states.
 *
 * Graceful shutdown protocol (Rule #35):
 *   RUNNING -> (terminate signal) -> DRAINING
 *   -> grace_period expires OR all in-flight complete -> TERMINATED
 *   DRAINING agent MUST NOT spawn new child agents (drain evasion prevention).
 *
 * FROZEN: Spec Addendum (2026-03-24, Cycle 20260324_cycle03-1).
 */
export type AgentLifecycleStatus =
  | 'running'
  | 'draining'
  | 'terminated'
  | 'stopped'
  | 'unknown';

/**
 * Registry entry for a running agent, extended with process tree fields.
 *
 * FROZEN: Spec Addendum (2026-03-24, Cycle 20260324_cycle03-1).
 */
export interface AgentRegistryEntry {
  agentId: string;
  pid: number;
  status: AgentLifecycleStatus;
  configPath: string;
  socketPath: string;
  logFile: string;
  uptime: number;
  /**
   * Parent agent ID.
   * undefined = root agent (spawned directly, not via spawnChildAgent).
   * BABBAGE BCT: existing registry entries without this field are root agents.
   */
  parentAgentId?: string;
  /** IDs of all direct child agents (empty array if none). */
  childAgentIds: string[];
}

/**
 * A node in the process tree returned by getProcessTree().
 *
 * FROZEN: Spec Addendum (2026-03-24, Cycle 20260324_cycle03-1).
 */
export interface ProcessTreeNode {
  entry: AgentRegistryEntry;
  /** Recursive child nodes. Maximum depth: 3 (Rule #38). */
  children: ProcessTreeNode[];
}

/**
 * Error thrown when spawnChildAgent() is denied by the permission lattice
 * or because the parent is in DRAINING state.
 *
 * FROZEN: Spec Addendum (2026-03-24, Cycle 20260324_cycle03-1).
 */
export interface SpawnDeniedError {
  code: 'SPAWN_DENIED';
  reason: 'DRAINING' | 'PATH_VIOLATION' | 'BUDGET_EXCEEDED' | 'CEILING_EXCEEDED' | 'CAPABILITY_VIOLATION';
  parentId: string;
  detail?: string;
}

/**
 * RPC error codes extended with Plan37 C8 codes.
 *
 * FROZEN: Spec Addendum (2026-03-24, Cycle 20260324_cycle03-1).
 */
export const Plan37RPCErrorCode = {
  SPAWN_DENIED: -32010,
  AGENT_NOT_FOUND_FOR_TREE: -32011,
  PARENT_DRAINING: -32012,
  PERMISSION_LATTICE_VIOLATION: -32013,
} as const;

/**
 * Daemon control plane interface.
 *
 * Consolidates all RPC-accessible daemon operations into a single typed contract.
 * The IPC server's onRequest handler delegates to an implementation of this interface.
 *
 * FROZEN: Spec Addendum (2026-03-24, Cycle 20260324_cycle03-1).
 * Classification: Mechanism — non-bypassable typed contract for daemon RPC.
 */
export interface IDaemonControlPlane {
  // Existing methods (consolidated from daemon-entry.ts onRequest handler)
  ping(): Promise<{ pong: true }>;
  getAgentStatus(): Promise<AgentStatus>;
  stopAgent(): Promise<{ success: true }>;
  getDaemonHealth(): Promise<{ uptime: number; version: string }>;
  attachSession(
    options: AttachOptions | undefined,
    socket: import('node:net').Socket
  ): Promise<AttachResult>;
  pushAgentInput(msg: InputMessage): Promise<{ success: true }>;
  detachSession(
    msg: DetachMessage,
    socket: import('node:net').Socket
  ): Promise<{ success: true }>;
  listClients(): Promise<ListClientsResult>;

  // New methods — Plan37 C8: Process Tree
  spawnChildAgent(
    parentId: string,
    childConfig: ChildAgentSpawnConfig
  ): Promise<DaemonSpawnResult>;
  getProcessTree(): Promise<ProcessTreeNode[]>;
  getChildAgents(parentId: string): Promise<AgentRegistryEntry[]>;

  // New method — Doc 26 (v0.59.7-alpha): enumerate persisted sessions for the
  // daemon's agent. Backs the `agent.list-sessions` RPC and the `/session list`
  // REPL command. Producer: FileSessionPersistence.listSessions (read-only).
  listSessions(): Promise<SessionIndexEntry[]>;
}
