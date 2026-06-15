/**
 * observability — Plan48 wire-in (FIX-2026-06-11 repair sprint).
 *
 * Connects the Plan48 modules (structured-log writer, audit-sink) to the
 * live runner. Until this wire-in, the Plan48 modules were delivered with
 * tests but never imported from any production path (2026-06-11 repair
 * audit finding); the C48-M2a claim "audit-sink subscribes at runner
 * startup" was satisfied only in unit tests.
 *
 * Activation is opt-in — zero behavior change when env is unset:
 *   - structured-log: `OPENSTARRY_LOG_PATH=<file>` → JSONL lifecycle
 *     records (runner:started / plugin:loaded / runner:shutdown), level
 *     filtered via `LOG_LEVEL` (Tech Spec 18).
 *   - audit-sink: `OPENSTARRY_AUDIT=1` (or `AUDIT_SINK_PATH=<file>`) →
 *     journals `capability_denied` events to <data_dir>/audit-trail.jsonl.
 *     Live producer: tool-filter-proxy denials forwarded from start.ts.
 *     (`ws_connection_denied` is subscribed but currently has no producer.)
 *
 * Shutdown flush runs through the shared Plan48 registry (structured-log
 * order 200 → audit-sink order 300). Signal handlers are NOT installed
 * here — the start command owns SIGINT/SIGTERM and calls `flush()` inside
 * its own shutdown path to avoid double-handling.
 *
 * NOT wired (honest status): hmac-cleanup (C48-M3) remains a library —
 * integrating its capture-and-zero key flow requires refactoring the
 * checkpoint HMAC path (snapshot-hmac.ts) and was judged out of repair
 * scope; see apps/runner/src/hmac-cleanup/README.md.
 */

import { AuditBus, AuditSink } from "./audit-sink/index.js";
import type { CapabilityDeniedEvent } from "./audit-sink/index.js";
import {
  StructuredLogWriter,
  resolveLogPath,
  registerStructuredLogShutdown,
} from "./structured-log/index.js";
import {
  createShutdownHookRegistry,
  type ShutdownHookRegistry,
  type ShutdownReason,
} from "./audit-infra/shutdown-hooks.js";
import { setSchemaDriftAuditSink } from "./schema-drift-policy/index.js";

export interface Observability {
  /** Structured-log writer, or null when OPENSTARRY_LOG_PATH is unset. */
  readonly log: StructuredLogWriter | null;
  /** Audit bus, or null when audit-sink is disabled. */
  readonly auditBus: AuditBus | null;
  /** Shared shutdown registry (flush cascade, deterministic order). */
  readonly shutdown: ShutdownHookRegistry;
  /** Publish a capability-denied audit event (no-op when sink disabled). */
  publishCapabilityDenied(event: Omit<CapabilityDeniedEvent, "type">): void;
  /** Run the flush cascade. Safe to call multiple times. */
  flush(reason?: ShutdownReason): Promise<void>;
}

export interface ObservabilityOptions {
  /** Test override: force-enable audit sink with this path. */
  readonly auditPath?: string;
  /** Test override: force structured-log to this path. */
  readonly logPath?: string;
}

export function createObservability(opts: ObservabilityOptions = {}): Observability {
  const registry = createShutdownHookRegistry();

  const logPath = opts.logPath ?? resolveLogPath();
  let writer: StructuredLogWriter | null = null;
  if (logPath !== undefined) {
    writer = new StructuredLogWriter({ outputPath: logPath });
    registerStructuredLogShutdown(registry, writer);
  }

  // GAP-2026-06-15: wire the schema-drift audited-mode sink. setSchemaDriftAuditSink
  // previously had only test callers, so SCHEMA_DRIFT_MODE=audited dropped its events
  // into the no-op default. Route them to the structured-log writer when one exists;
  // otherwise leave the no-op (zero behavior change when OPENSTARRY_LOG_PATH is unset).
  if (writer !== null) {
    const w = writer;
    setSchemaDriftAuditSink((e) => { w.info(e.event, e); });
  } else {
    setSchemaDriftAuditSink(undefined);
  }

  const auditEnabled =
    opts.auditPath !== undefined ||
    process.env["OPENSTARRY_AUDIT"] === "1" ||
    (process.env["AUDIT_SINK_PATH"] ?? "") !== "";
  let auditBus: AuditBus | null = null;
  if (auditEnabled) {
    auditBus = new AuditBus();
    const sink = new AuditSink({
      bus: auditBus,
      config: opts.auditPath !== undefined ? { path: opts.auditPath } : undefined,
    });
    sink.attach();
    sink.registerShutdown(registry);
  }

  return {
    log: writer,
    auditBus,
    shutdown: registry,
    publishCapabilityDenied(event) {
      auditBus?.publish({ type: "capability_denied", ...event });
    },
    async flush(reason: ShutdownReason = "programmatic") {
      await registry.trigger(reason);
    },
  };
}
