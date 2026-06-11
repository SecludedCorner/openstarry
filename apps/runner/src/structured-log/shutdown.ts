/**
 * structured-log/shutdown — C48-M1e SIGTERM/SIGINT sync flush.
 *
 * Registers a shutdown hook with {@link SHUTDOWN_ORDER.FLUSH_STRUCTURED_LOG}
 * that drains the writer's ring buffer before the process exits. Shares
 * infra with C48-M2g (audit-sink uses the same registry at a later order).
 *
 * Plan48 §2.4 integration: hook order is deterministic; the registry
 * awaits each hook serially, so structured-log is fully flushed before
 * audit-sink flush begins.
 *
 * @since Plan48 C48-M1e
 */

import type { ShutdownHookRegistry } from '../audit-infra/shutdown-hooks.js';
import { SHUTDOWN_ORDER } from '../audit-infra/shutdown-hooks.js';
import type { StructuredLogWriter } from './writer.js';

export const STRUCTURED_LOG_SHUTDOWN_ID = 'structured-log.flush';

export function registerStructuredLogShutdown(
  registry: ShutdownHookRegistry,
  writer: StructuredLogWriter,
): void {
  registry.register({
    id: STRUCTURED_LOG_SHUTDOWN_ID,
    order: SHUTDOWN_ORDER.FLUSH_STRUCTURED_LOG,
    fn: () => { writer.flushSync(); },
  });
}
