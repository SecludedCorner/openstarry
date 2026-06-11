/**
 * audit-infra/shutdown-hooks — W0 Plan48 shared infra.
 *
 * Ordered shutdown-hook registration for SIGTERM/SIGINT paths. Plan48 §2.4
 * integration ordering:
 *   order 100 — stop accepting new events
 *   order 200 — flush structured-log buffer (C48-M1e)
 *   order 300 — flush audit-sink buffer (C48-M2g)
 *   order 400 — HMAC key clear + shutdown sign (C48-M3a + C48-M3d)
 *   order 999 — process exit
 *
 * Hooks are invoked in ascending order; each is awaited synchronously so
 * flush completes before the next hook begins (C48-M1e zero-entries-lost).
 *
 * Layer: Runner (NOT Core; MR-6 preserved).
 *
 * @since Plan48 W0 shared infra
 */

export type ShutdownReason = 'SIGTERM' | 'SIGINT' | 'programmatic';

export interface ShutdownHook {
  readonly id: string;
  readonly order: number;
  readonly fn: (reason: ShutdownReason) => void | Promise<void>;
}

export interface ShutdownHookRegistry {
  register(hook: ShutdownHook): void;
  unregister(id: string): void;
  list(): readonly ShutdownHook[];
  trigger(reason: ShutdownReason): Promise<void>;
  installSignalHandlers(): void;
  uninstallSignalHandlers(): void;
}

export function createShutdownHookRegistry(): ShutdownHookRegistry {
  const hooks = new Map<string, ShutdownHook>();
  let sigtermHandler: (() => void) | null = null;
  let sigintHandler: (() => void) | null = null;
  let triggering = false;

  async function trigger(reason: ShutdownReason): Promise<void> {
    if (triggering) return;
    triggering = true;
    const sorted = Array.from(hooks.values()).sort((a, b) => a.order - b.order);
    for (const h of sorted) {
      try {
        await h.fn(reason);
      } catch {
        // Hook failures must never halt the cascade — one flush failing
        // should not block a subsequent HMAC clear.
      }
    }
  }

  return {
    register(hook) {
      hooks.set(hook.id, hook);
    },
    unregister(id) {
      hooks.delete(id);
    },
    list() {
      return Array.from(hooks.values());
    },
    trigger,
    installSignalHandlers() {
      if (sigtermHandler || sigintHandler) return;
      sigtermHandler = () => {
        void trigger('SIGTERM');
      };
      sigintHandler = () => {
        void trigger('SIGINT');
      };
      process.on('SIGTERM', sigtermHandler);
      process.on('SIGINT', sigintHandler);
    },
    uninstallSignalHandlers() {
      if (sigtermHandler) {
        process.off('SIGTERM', sigtermHandler);
        sigtermHandler = null;
      }
      if (sigintHandler) {
        process.off('SIGINT', sigintHandler);
        sigintHandler = null;
      }
    },
  };
}

export const SHUTDOWN_ORDER = {
  STOP_ACCEPTING: 100,
  FLUSH_STRUCTURED_LOG: 200,
  FLUSH_AUDIT_SINK: 300,
  HMAC_CLEAR_AND_SIGN: 400,
  PROCESS_EXIT: 999,
} as const;
