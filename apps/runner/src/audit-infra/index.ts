/**
 * audit-infra — W0 Plan48 shared infra public surface.
 *
 * Consumed by:
 *   - structured-log/ (C48-M1 family)
 *   - audit-sink/    (C48-M2 family)
 *   - hmac-cleanup/  (C48-M3 family, shutdown ordering only)
 *
 * @since Plan48
 */

export { BufferedWriter } from './buffered-writer.js';
export type { BufferedWriterOptions } from './buffered-writer.js';

export { envString, envInt, envEnum } from './env-parse.js';

export { isoTimestamp } from './iso-timestamp.js';

export {
  createShutdownHookRegistry,
  SHUTDOWN_ORDER,
} from './shutdown-hooks.js';
export type {
  ShutdownReason,
  ShutdownHook,
  ShutdownHookRegistry,
} from './shutdown-hooks.js';
