/**
 * IDaemonCommService — cross-daemon agent↔agent messaging exposed to in-loop tools.
 *
 * Fractal Society C/T1 (Spec Addendum C, Master-ratified 2026-06-26). Until now
 * the daemon "comm" layer (MessageRouter / channels / EventBridge) validated
 * messages but had NO transport — nothing delivered a CommMessage to another
 * agent's process. This service is the real producer/consumer surface:
 *   - send():     deliver a message to a peer agent's daemon over the proven
 *                 line-delimited JSON-RPC wire (generalizes the alaya transport),
 *                 HMAC-signed so the sender's `source` cannot be forged, and
 *                 fail-closed validated (capability + replay + freshness) on receipt.
 *   - readInbox(): read messages this agent has received.
 *
 * The daemon fills id/timestamp/source/traceDepth; the caller supplies the
 * target, payload, and optional performative. Outside daemon mode the service is
 * absent and the `agent-comm` plugin's tools report a clear daemon-only message.
 *
 * Honest scope (inherited from the alaya transport it generalizes): same-host
 * (named pipe / UDS), trusted-parent key. Cross-host / N>2 gossip are future.
 *
 * Layer: SDK type only — impl lives in the runner daemon (Core never networks).
 */

import type { IPluginService } from "./service.js";
import type { CommMessage, CommPerformative } from "./comm-channel.js";

/** Parameters for sending a message to a peer agent. */
export interface DaemonCommSendInput {
  /** Target agent id. */
  readonly target: string;
  /** JSON-serializable message body. */
  readonly payload: unknown;
  /** FIPA-ACL speech act (default 'inform'). */
  readonly performative?: CommPerformative;
}

/** Result of a send attempt (resolves on delivery ack; rejects on denial/timeout). */
export interface DaemonCommSendResult {
  readonly delivered: boolean;
  readonly messageId: string;
}

/**
 * A cluster coordination event received from a peer agent's daemon (C/T2,
 * Fractal Society pub/sub). Mirrors the daemon's CoordinationMessage: `agentId`
 * is the SUBJECT of the event (the publisher), `type` the lifecycle event
 * (e.g. 'agent:leaving' / 'agent:status_changed').
 */
export interface DaemonCoordinationEvent {
  readonly type: string;
  readonly agentId: string;
  readonly timestamp: number;
  readonly payload?: unknown;
}

/**
 * A discovered service provider (C/T3, Fractal Society discovery). Returned by
 * findPeer() — resolve a service NAME to the addressable agent(s) providing it,
 * then message one with send(). `socketPath` is the provider's daemon endpoint
 * (present when the registry recorded it; addressing within a same-home cluster
 * also works from `agentId` alone).
 */
export interface DaemonPeerEndpoint {
  readonly serviceName: string;
  readonly agentId: string;
  readonly socketPath?: string;
}

/** Per-target outcome of a broadcast (C/T4 fan-out); one failure does not abort the rest. */
export interface DaemonBroadcastResult {
  readonly target: string;
  readonly delivered: boolean;
  readonly error?: string;
}

/**
 * Service exposed by the daemon so an in-loop tool can message peer agents,
 * read its own inbox, participate in cluster pub/sub, and discover peers by
 * service name. Rejects (throws) on HMAC / capability / replay denials — the
 * tool surfaces the denial to the model.
 *
 * Pub/sub (C/T2) is subscriber-initiated: subscribe() registers THIS agent on a
 * PEER's daemon EventBridge (signed), so when that peer publishes a lifecycle
 * event it is delivered back here and surfaced via readEvents().
 *
 * Discovery (C/T3) closes the registry loop: registerService() publishes a named
 * service on a registry hub (signed), findPeer() resolves a service name to its
 * provider(s) via that hub — the result feeds send() to actually talk to them.
 */
export interface IDaemonCommService extends IPluginService {
  send(input: DaemonCommSendInput): Promise<DaemonCommSendResult>;
  readInbox(limit?: number): Promise<readonly CommMessage[]>;
  subscribe(peerId: string, eventTypes: string[]): Promise<{ subscribed: boolean }>;
  readEvents(limit?: number): Promise<readonly DaemonCoordinationEvent[]>;
  registerService(registry: string, serviceName: string): Promise<{ registered: boolean }>;
  findPeer(registry: string, serviceName: string): Promise<readonly DaemonPeerEndpoint[]>;
  /** C/T4 — send a `request` and await the correlated reply (rejects on timeout). */
  request(target: string, payload: unknown, timeoutMs?: number): Promise<CommMessage>;
  /** C/T4 — reply to a request (carries correlationId = the request id). */
  reply(target: string, correlationId: string, payload: unknown): Promise<DaemonCommSendResult>;
  /** C/T4 — fan-out a message to multiple targets (per-target result). */
  broadcast(
    targets: string[],
    payload: unknown,
    performative?: CommPerformative,
  ): Promise<readonly DaemonBroadcastResult[]>;
  /** Pipeline topology — relay a message along an ordered route of agent ids. */
  pipeline(
    route: string[],
    payload: unknown,
    performative?: CommPerformative,
  ): Promise<{ delivered: boolean; pipelineId: string; firstHop: string }>;
}
