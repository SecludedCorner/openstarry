# structured-log (Plan48 F-L3-SEC-2)

Self-built, zero-external-dep structured-log facility living in the runner
layer (NOT Core; MR-6 preserved). Delivers Plan48 `C48-M1` sub-items:

| Sub-item | Surface |
|----------|---------|
| C48-M1a  | `writer.ts` `StructuredLogWriter` (zero external dep) |
| C48-M1b  | JSON-line schema `{timestamp, level, event, payload}` |
| C48-M1c  | Level filter via `LOG_LEVEL` env (DEBUG/INFO/WARN/ERROR/FATAL) |
| C48-M1d  | Ring-buffer back-pressure → `W_AUDIT_OVERFLOW` warn emit |
| C48-M1e  | Sync flush on SIGTERM/SIGINT via `registerStructuredLogShutdown` |
| C48-M1f  | Test-harness emits ≥ 1 event per W2-R13 scenario (see integration test) |
| C48-M1g  | This README + CHANGELOG + Doc 78 candidate (`docs/EN/structured-log.md`) |
| C48-M1h  | ENG-FAB F-9 audit: module+test, doc+CHANGELOG, runtime evidence |

## Environment variables

| Name                           | Default       | Notes                                       |
|--------------------------------|---------------|---------------------------------------------|
| `LOG_LEVEL`                    | `INFO`        | One of DEBUG / INFO / WARN / ERROR / FATAL. |
| `OPENSTARRY_LOG_PATH`          | *(stderr)*    | Absolute path to a JSONL file. Optional.    |
| `OPENSTARRY_LOG_BUFFER_MAX`    | `1024`        | Ring-buffer max entries. Overflow drops FIFO + emits `W_AUDIT_OVERFLOW`. |

## JSON-line schema (C48-M1b)

Every line is a single JSON object:

```
{
  "timestamp": "2026-04-25T10:11:12.345Z",
  "level": "INFO",
  "event": "runner.boot",
  "payload": { ... } | null
}
```

`safe-stringify.ts` handles circular references, BigInt, very long strings,
and Error instances without throwing.

## Back-pressure (C48-M1d)

Ring-buffer of configurable size. When full, the oldest entry is dropped and
a one-shot `W_AUDIT_OVERFLOW` WARN record is emitted to the underlying sink.
`resetOverflowReported()` re-arms the signal (tests).

## Shutdown (C48-M1e)

`registerStructuredLogShutdown(registry, writer)` attaches a hook at
`SHUTDOWN_ORDER.FLUSH_STRUCTURED_LOG` (200). The registry awaits each hook
serially, so structured-log is fully drained before audit-sink flush
(`SHUTDOWN_ORDER.FLUSH_AUDIT_SINK` = 300).
