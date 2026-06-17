/**
 * audit-sink — Plan48 C48-M2 public surface (F-L3-SEC-3).
 *
 * Subscribes to runner-side AuditBus for `capability_denied` (C48-M2c) and
 * `ws_connection_denied` (C48-M2d) events, deduplicates via (timestamp,
 * event_hash) composite key (C48-M2b), and journals to a JSONL audit-trail
 * file (C48-M2e). Shares back-pressure (C48-M2f) and shutdown flush
 * (C48-M2g) infra with structured-log.
 *
 * @since Plan48 C48-M2
 */

export { AuditBus } from './audit-bus.js';
export type {
  AuditEvent,
  AuditEventType,
  CapabilityDeniedEvent,
  WsConnectionDeniedEvent,
  AgentRequestDeniedEvent,
} from './audit-bus.js';

export { DedupeWindow, dedupeKey, hashEvent } from './dedupe.js';

export {
  resolveAuditSinkConfig,
  DEFAULT_AUDIT_SINK_PATH_REL,
  DEFAULT_AUDIT_BUFFER_MAX,
  DEFAULT_DEDUPE_WINDOW,
} from './config.js';
export type { AuditSinkConfig } from './config.js';

export {
  AuditSink,
  AUDIT_SINK_SHUTDOWN_ID,
  AUDIT_OVERFLOW_EVENT,
} from './sink.js';
export type { AuditSinkOptions, AuditSinkStats } from './sink.js';
