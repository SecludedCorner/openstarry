/**
 * ICommChannel — unified multi-agent communication channel interface.
 *
 * FROZEN: Architecture Review (2026-03-24, Cycle 20260324_cycle03-1).
 * FROZEN: Spec Addendum (2026-03-24) — CommMessage.source field name.
 * Any changes require a new Spec Addendum through the Coordinator.
 *
 * See: share/openstarry_doc/Architecture_Documentation/53_Multi_Agent_Communication_Interface_Spec.md
 */

import type { IPluginService } from "./service.js";

/**
 * Capabilities a communication channel may declare.
 * Channels only implement optional methods for declared capabilities.
 */
export type CommCapability =
  | 'messaging'    // send, onMessage, reply
  | 'streaming'    // subscribe, publish
  | 'rpc'          // call, expose
  | 'composable';  // supports CompositeChannel composition

/**
 * Channel connection lifecycle states.
 */
export type CommChannelStatus =
  | 'disconnected'  // Not connected. Initial state.
  | 'connecting'    // Connection in progress.
  | 'connected'     // Active and ready for communication.
  | 'draining'      // Completing in-flight messages, not accepting new ones.
  | 'error';        // Connection error. May attempt reconnection.

/**
 * Topology declared by the channel.
 */
export type CommTopology =
  | 'point-to-point'
  | 'broadcast'
  | 'request-response'
  | 'pipeline';

/**
 * FIPA ACL performative intent for CommMessage.
 */
export type CommPerformative =
  | 'inform'
  | 'request'
  | 'agree'
  | 'refuse'
  | 'propose'
  | 'query-ref'
  | 'cfp'
  | 'failure';

/**
 * A message exchanged between agents.
 *
 * FROZEN: CommMessage.source (not 'from') — Spec Addendum FINDING-6.
 * Spec Addendum (Plan38 C13): metadata field added (SEC-008).
 */
export interface CommMessage {
  /** UUID v4 */
  id: string;
  /** Unix ms */
  timestamp: number;
  /** Source Agent ID (verified by MessageRouter) */
  source: string;
  /** Target Agent ID (optional for broadcast) */
  target?: string;
  /** JSON-serializable payload */
  payload: unknown;
  /** FIPA ACL intent (default: 'inform') */
  performative?: CommPerformative;
  /** Distributed tracing ID */
  traceId?: string;
  /** Incremented per hop; rejected if > MAX_TRACE_DEPTH */
  traceDepth?: number;
  /** Timeout hierarchy: outer > sum of inner */
  timeoutMs?: number;
  /** For request-response matching (reply sets this = original id) */
  correlationId?: string;
  /** Optional key-value metadata. SEC-008: size-limited by MessageRouter. */
  metadata?: Record<string, string>;
}

/**
 * Handler type for incoming messages.
 * Parameter 'from' is the sender's agent ID passed by the channel — distinct from CommMessage.source.
 */
export type CommMessageHandler = (msg: CommMessage, from: string) => void;

/**
 * Unified communication channel interface.
 * All multi-agent communication modes implement this interface.
 *
 * FROZEN: Architecture Review (2026-03-24, Cycle 20260324_cycle03-1).
 */
export interface ICommChannel extends IPluginService {
  // Inherited from IPluginService:
  // name: string;    // Channel unique name (e.g., "pipeline", "hub-spoke")
  // version: string; // Semantic version

  /** Capabilities supported by this channel. */
  readonly capabilities: readonly CommCapability[];

  /** Channel topology type. */
  readonly topology: CommTopology;

  /** Get current connection status. */
  getStatus(): CommChannelStatus;

  /**
   * Establish connection.
   * @param target - Optional target identifier (Agent ID, URL, etc.)
   */
  connect(target?: string): Promise<void>;

  /** Gracefully disconnect. Complete in-flight messages before closing. */
  disconnect(): Promise<void>;

  // --- Message-level (requires 'messaging' capability) ---

  /**
   * Send a message to a target Agent.
   * Routes through Daemon's MessageRouter for capability verification.
   * @throws CommCapabilityError if channel lacks 'messaging' capability.
   */
  send?(target: string, message: CommMessage): Promise<void>;

  /**
   * Register a handler for incoming messages.
   * @returns Unsubscribe function.
   */
  onMessage?(handler: CommMessageHandler): () => void;

  /**
   * Reply to a specific message by ID.
   */
  reply?(msgId: string, response: CommMessage): Promise<void>;

  // --- Stream-level (requires 'streaming' capability) ---

  /**
   * Subscribe to a topic. Returns async iterable of messages.
   */
  subscribe?(topic: string): AsyncIterable<CommMessage>;

  /**
   * Publish a message to a topic.
   */
  publish?(topic: string, message: CommMessage): Promise<void>;

  // --- RPC-level (requires 'rpc' capability) ---

  /**
   * Call a remote method on another Agent.
   */
  call?(method: string, params: unknown): Promise<unknown>;

  /**
   * Expose a method for remote invocation by other Agents.
   * Only methods listed in agent.json exposedTools are callable.
   */
  expose?(method: string, handler: (params: unknown) => Promise<unknown>): void;
}

/**
 * Error thrown when a channel method is called without the required capability.
 */
export class CommCapabilityError extends Error {
  constructor(
    public readonly channel: string,
    public readonly requiredCapability: CommCapability,
    public readonly availableCapabilities: readonly CommCapability[]
  ) {
    super(
      `Channel "${channel}" does not support "${requiredCapability}". ` +
      `Available: [${availableCapabilities.join(', ')}]`
    );
    this.name = 'CommCapabilityError';
  }
}

/**
 * Registry interface for CommChannel discovery and lookup.
 *
 * FROZEN: Architecture Review (2026-03-24, Cycle 20260324_cycle03-1).
 */
export interface ICommChannelRegistry {
  register(channel: ICommChannel): void;
  unregister(name: string): void;
  get(name: string): ICommChannel | undefined;
  list(): ICommChannel[];
  findByCapability(cap: CommCapability): ICommChannel[];
  findByTopology(topology: CommTopology): ICommChannel[];
}
