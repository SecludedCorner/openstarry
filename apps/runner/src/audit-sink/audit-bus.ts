/**
 * audit-sink/audit-bus — C48-M2a runner-side event bus.
 *
 * Small in-process event bus that the audit-sink subscribes to. Plugins and
 * runner modules call `publishAuditEvent(bus, event)` to journal an event;
 * subscribers (the audit-sink) receive the same event-object instance.
 *
 * Kept deliberately minimal — no wildcard matching, no async, no buffering
 * at the bus itself (the sink owns its own ring buffer). This keeps Core
 * untouched (MR-6) and avoids reimplementing a generic pub/sub system.
 *
 * @since Plan48 C48-M2a
 */

import { EventEmitter } from 'node:events';

export type AuditEventType =
  | 'capability_denied'
  | 'ws_connection_denied'
  | 'agent_request_denied';

export interface CapabilityDeniedEvent {
  readonly type: 'capability_denied';
  readonly plugin: string;
  readonly tool: string;
  readonly allowedTools: readonly string[];
  readonly timestamp: string;
}

export interface WsConnectionDeniedEvent {
  readonly type: 'ws_connection_denied';
  readonly reason: 'auth_failed' | 'origin_blocked' | 'rate_limited' | 'protocol';
  readonly remote?: string;
  readonly url?: string;
  readonly origin?: string;
  readonly timestamp: string;
}

/**
 * Daemon-side request denial (⑦ Tech Spec 18 / Doc 46). Emitted when the
 * daemon rejects an inbound request for a policy reason — fail-closed paths
 * that previously left no audit trail:
 *   - 'rate_limited': DualRateLimiter rejected an agent.input (-32005).
 *   - 'spawn_constraint': handleSpawnChild denied an agent.spawnChild
 *     (DRAINING / path-traversal / capability / depth-budget-ceiling).
 *   - 'comm_denied': comm.deliver / comm.send rejected a cross-daemon agent↔agent
 *     message (Fractal Society C/T1, Spec Addendum C) — HMAC verification,
 *     capability (canSendTo/canReceiveFrom), replay/freshness, or malformed
 *     envelope. The new cross-process attack surface; every rejection is journaled.
 * `detail` carries the specific sub-reason (e.g. 'DRAINING', 'CEILING_EXCEEDED',
 * 'HMAC:<source>', 'INBOUND:<reason>').
 */
export interface AgentRequestDeniedEvent {
  readonly type: 'agent_request_denied';
  readonly reason: 'rate_limited' | 'spawn_constraint' | 'comm_denied';
  readonly agentId: string;
  readonly detail?: string;
  readonly timestamp: string;
}

export type AuditEvent =
  | CapabilityDeniedEvent
  | WsConnectionDeniedEvent
  | AgentRequestDeniedEvent;

export class AuditBus {
  private readonly emitter = new EventEmitter();

  subscribe<T extends AuditEventType>(
    type: T,
    handler: (event: Extract<AuditEvent, { type: T }>) => void,
  ): () => void {
    this.emitter.on(type, handler as (e: unknown) => void);
    return () => this.emitter.off(type, handler as (e: unknown) => void);
  }

  publish(event: AuditEvent): void {
    this.emitter.emit(event.type, event);
  }

  listenerCount(type: AuditEventType): number {
    return this.emitter.listenerCount(type);
  }
}
