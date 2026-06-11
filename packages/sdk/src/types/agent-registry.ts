/**
 * Agent registry types for openstarry-channel.
 * Plan38 W1 — frozen interfaces as of Architecture_Spec Plan38, Cycle 20260328_cycle03-2.
 *
 * MECHANISM: state machine transitions are non-bypassable.
 * @since v0.38.0-alpha
 */

/**
 * Agent health state in the openstarry-channel registry.
 * State transitions: HEALTHY -> DEGRADED -> UNREACHABLE -> TERMINATED.
 * Reverse transitions (recovery): UNREACHABLE -> HEALTHY (on reconnect).
 * TERMINATED is terminal — no recovery. Agent must re-register.
 *
 * MECHANISM: state machine transitions are non-bypassable.
 * @since v0.38.0-alpha
 */
export type AgentHealthState =
  | 'HEALTHY'       // Heartbeat responding within threshold
  | 'DEGRADED'      // Partial heartbeat failures, still reachable
  | 'UNREACHABLE'   // All recent heartbeats missed, not yet confirmed dead
  | 'TERMINATED';   // Confirmed terminated; entry pending removal

/**
 * Registry entry for a connected agent in openstarry-channel.
 * Created on successful register_agent (5-step validation).
 * Removed by 7-step crash handling or deregister_agent.
 *
 * FROZEN: Architecture_Spec Plan38, Cycle 20260328_cycle03-2.
 * @since v0.38.0-alpha
 */
export interface IAgentRegistryEntry {
  /** Unique agent identifier. */
  readonly agentId: string;
  /** Channel-assigned session identifier. */
  readonly channelId: string;
  /** Current health state. */
  health: AgentHealthState;
  /** Agent's MCP Server endpoint URL for connect-back. */
  readonly mcpEndpoint: string;
  /** PID of the agent process (for SEC-002 identity verification). */
  readonly pid: number;
  /** Capabilities declared at register_agent time. Rule #37: zero-default. */
  readonly capabilities: readonly string[];
  /** Tools the agent exposes for remote call (must have >= 1 at registration). */
  readonly exposedTools: readonly string[];
  /** Unix ms timestamp of last successful heartbeat. */
  lastHeartbeat: number;
  /** Registration timestamp (Unix ms). */
  readonly registeredAt: number;
  /** Count of consecutive missed heartbeats. MECHANISM: >= DEFAULT_HEARTBEAT_MISS_THRESHOLD -> TERMINATED. */
  consecutiveMisses: number;
}

/**
 * Lightweight agent summary for list_agents (informational, no capability gate).
 * Returns only health and id — no sensitive endpoint or capability data.
 * Fail-open per Rule #29 (informational only).
 *
 * FROZEN: Architecture_Spec Plan38, Cycle 20260328_cycle03-2.
 * @since v0.38.0-alpha
 */
export interface AgentSummary {
  agentId: string;
  health: AgentHealthState;
}

/**
 * Detailed agent status for get_agent_status (capability-gated: canSendTo required).
 * Implements need-to-know per VITRUVIUS compromise.
 *
 * FROZEN: Architecture_Spec Plan38, Cycle 20260328_cycle03-2.
 * @since v0.38.0-alpha
 */
export interface AgentDetailedStatus {
  agentId: string;
  health: AgentHealthState;
  exposedTools: readonly string[];
  lastHeartbeat: number;
  activeSessions: number;
}

/**
 * Response from register_agent — self-describing protocol.
 * Agent uses channelId for subsequent calls; heartbeatIntervalMs
 * tells agent how often to expect probes.
 *
 * FROZEN: Architecture_Spec Plan38, Cycle 20260328_cycle03-2.
 * @since v0.38.0-alpha
 */
export interface RegisterAgentResponse {
  channelId: string;
  heartbeatIntervalMs: number;
}

/**
 * openstarry-channel process lifecycle state.
 * Channel process progresses through these states exactly once
 * (RUNNING -> DRAINING -> TERMINATED is the shutdown path).
 *
 * FROZEN: Architecture_Spec Plan38, Cycle 20260328_cycle03-2.
 * @since v0.38.0-alpha
 */
export type ChannelProcessState =
  | 'STARTING'     // Process spawned, awaiting READY signal
  | 'RUNNING'      // READY received, accepting registrations
  | 'DRAINING'     // Shutdown initiated, completing in-flight operations
  | 'TERMINATED';  // Process has exited

/**
 * Result of a broadcast operation — per-target result array.
 * Individual failures do not abort the broadcast (Promise.allSettled semantics).
 *
 * FROZEN: Architecture_Spec Plan38, Cycle 20260328_cycle03-2.
 * @since v0.38.0-alpha
 */
export interface BroadcastResult {
  agentId: string;
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// W3: IRegistryEventBus (PROVISIONAL) — Plan39, Cycle 20260404_cycle03-3
// NOT FROZEN. Plan40 re-evaluation required.
// ---------------------------------------------------------------------------

/**
 * RegistryEventType — discriminated union of registry lifecycle events.
 *
 * PROVISIONAL: This interface is NOT FROZEN. It carries PROVISIONAL status
 * pending Plan40 Mesh validation (D3-R1, VITRUVIUS concession).
 * Breaking changes are anticipated; do not build stable consumers.
 *
 * @since v0.39.0-alpha
 * @provisional Plan40 re-evaluation required
 */
export type RegistryEventType =
  | 'agent:spawned'
  | 'agent:terminated'
  | 'agent:registered'
  | 'agent:health_changed';

/**
 * RegistryEvent — a single event emitted over the IPC channel.
 *
 * PROVISIONAL: Not frozen. See IRegistryEventBus.
 * @since v0.39.0-alpha
 */
export interface RegistryEvent {
  readonly type: RegistryEventType;
  readonly agentId: string;
  readonly timestamp: number;
  /** Event-specific payload. Shape depends on `type`. */
  readonly payload?: unknown;
}

/**
 * IRegistryEventBus — event bus over the Daemon-Channel IPC fork channel.
 *
 * Trust hierarchy (CONSTRAINT-D12, Daemon-authoritative invariant):
 * - Daemon is the single source of truth for agent identity and lifecycle.
 * - Channel registry is a read replica derived from Daemon-attested events.
 * - Channel-originated identity claims are REJECTED (AC-W3-3).
 * - Health state (HEALTHY/DEGRADED/UNREACHABLE) is advisory from Channel.
 *
 * Transport: child_process.fork IPC channel (CONSTRAINT-D13).
 * READY signal: Channel emits structured stdout READY before accepting IPC events.
 *
 * AT-7 attack vectors closed by this design:
 * - AT-7a (Ghost Agent): Channel cannot register agent without Daemon attestation
 * - AT-7b (Shadow Agent): Duplicate agentId rejected at Daemon layer
 * - AT-7c (Identity Split): agentId-to-PID binding verified at Daemon (SEC-002)
 *
 * PROVISIONAL: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * NOT FROZEN. Plan40 re-evaluation required.
 * @since v0.39.0-alpha
 */
export interface IRegistryEventBus {
  /** Emit a registry event over the IPC channel. Daemon-side only. */
  emit(event: RegistryEvent): void;
  /** Subscribe to registry events. Channel-side only. Returns unsubscribe fn. */
  on(type: RegistryEventType, handler: (event: RegistryEvent) => void): () => void;
  /** Check if IPC channel is ready. */
  isReady(): boolean;
}

/**
 * ReadySignal — structured READY message emitted on stdout by Channel process.
 * Daemon waits for this before forwarding spawn events (AC-W3-1).
 *
 * PROVISIONAL: Not frozen. See IRegistryEventBus.
 * @since v0.39.0-alpha
 */
export interface ReadySignal {
  readonly type: 'READY';
  readonly channelId: string;
  readonly timestamp: number;
  readonly version: string;
}

// ---------------------------------------------------------------------------
// W4: withChannelGuard HOF — Plan39, Cycle 20260404_cycle03-3
// FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
// ---------------------------------------------------------------------------

/**
 * ChannelGuardError — typed error returned when an operation is rejected
 * during DRAINING state. Does not throw; returns this value (AC-W4-1).
 *
 * FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * @since v0.39.0-alpha
 */
export interface ChannelGuardError {
  readonly code: 'CHANNEL_DRAINING';
  readonly message: string;
  readonly currentState: ChannelProcessState;
}

/**
 * withChannelGuard — Higher-Order Function wrapping channel operations
 * with DRAINING state protection.
 *
 * When the channel is in DRAINING state, the wrapped function is not
 * called; instead a ChannelGuardError is returned (never thrown).
 * In all other states, the wrapped function is called normally.
 *
 * Usage: wrap tool registration, agent registration, and any operation
 * that must not proceed during graceful shutdown.
 *
 * FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * @since v0.39.0-alpha
 */
export type WithChannelGuard = <T>(
  getState: () => ChannelProcessState,
  fn: () => Promise<T>,
) => Promise<T | ChannelGuardError>;
