/**
 * structured-log — Plan48 C48-M1 public surface (F-L3-SEC-2).
 *
 * Self-built, zero-external-dep structured-log facility for policy-path
 * observability. See `./README.md` for the full Plan48 mapping.
 *
 * @since Plan48 C48-M1
 */

export {
  StructuredLogWriter,
  LOG_LEVELS,
  DEFAULT_MAX_BUFFER,
  OVERFLOW_EVENT,
  resolveLogPath,
  openSyncSink,
} from './writer.js';
export type {
  LogLevel,
  StructuredLogRecord,
  StructuredLogWriterOptions,
} from './writer.js';

export {
  safeStringify,
  MAX_STRING_LEN,
  TRUNCATION_SENTINEL,
  CIRCULAR_SENTINEL,
} from './safe-stringify.js';

export {
  registerStructuredLogShutdown,
  STRUCTURED_LOG_SHUTDOWN_ID,
} from './shutdown.js';
