# audit-sink (Plan48 F-L3-SEC-3)

Runner-side subscriber that journals `capability_denied` and
`ws_connection_denied` audit events to a JSONL audit-trail file. Lives in
runner layer (NOT Core; NOT plugin) per Plan48 §2.2.

| Sub-item | Surface |
|----------|---------|
| C48-M2a  | `AuditBus` + `AuditSink.attach()` subscription pattern |
| C48-M2b  | `DedupeWindow` with `(timestamp, event_hash)` composite key |
| C48-M2c  | `capability_denied` subscribed |
| C48-M2d  | `ws_connection_denied` subscribed |
| C48-M2e  | `AUDIT_SINK_PATH` env; default `<data_dir>/audit-trail.jsonl` |
| C48-M2f  | Shared back-pressure with structured-log (reuses `BufferedWriter`) |
| C48-M2g  | Shared shutdown flush (`SHUTDOWN_ORDER.FLUSH_AUDIT_SINK`) |
| C48-M2h  | W2-R13 runtime instrumented scenarios (see integration test) |
| C48-M2i  | This README + CHANGELOG + ENG-FAB F-9 |

## Environment variables

| Name                          | Default                              | Notes                                  |
|-------------------------------|--------------------------------------|----------------------------------------|
| `AUDIT_SINK_PATH`             | `<data_dir>/audit-trail.jsonl`       | Absolute path to the JSONL file.       |
| `AUDIT_SINK_BUFFER_MAX`       | `512`                                | Ring-buffer max entries.               |
| `AUDIT_SINK_DEDUPE_WINDOW`    | `1024`                               | Recent-key dedup window.               |
| `OPENSTARRY_DATA_DIR`         | `~/.openstarry`                      | Used when `AUDIT_SINK_PATH` unset.     |

## Line schema

```
{
  "type": "capability_denied" | "ws_connection_denied",
  "plugin": "...",            // capability_denied
  "tool": "...",              // capability_denied
  "allowedTools": [...],      // capability_denied
  "reason": "...",            // ws_connection_denied
  "remote": "...",            // ws_connection_denied (optional)
  "url": "...",               // ws_connection_denied (optional)
  "origin": "...",            // ws_connection_denied (optional)
  "timestamp": "2026-04-25T10:11:12.345Z",
  "audit_key": "<ts>|<hash>"
}
```

## Wiring contract

1. Runner constructs an `AuditBus` at startup (after structured-log, before
   plugin load).
2. `new AuditSink({ bus }).attach()` subscribes.
3. `auditSink.registerShutdown(registry)` attaches the flush hook.
4. Tool-filter-proxy denial callbacks and transport-websocket security
   rejections call `bus.publish({ type, ...fields, timestamp })`.
5. Shutdown cascade: structured-log flush (200) → audit-sink flush (300) →
   HMAC clear & sign (400). Dedup window bounded to `AUDIT_SINK_DEDUPE_WINDOW`.
