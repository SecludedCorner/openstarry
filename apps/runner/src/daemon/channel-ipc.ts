/**
 * ChannelIpc — child_process.fork IPC channel for Daemon→Channel registry events.
 *
 * Plan39 W3: stdout READY signal + child_process.fork IPC channel (~20 LOC target).
 * CONSTRAINT-D13: Daemon forks Channel and communicates via IPC; READY signal gates
 * event forwarding (AC-W3-1).
 *
 * Protocol:
 * 1. Daemon forks Channel process with `child_process.fork()`.
 * 2. Daemon listens on Channel stdout for a ReadySignal JSON line.
 * 3. After READY is received, Daemon marks the channel ready and begins
 *    forwarding RegistryEvents over the IPC channel (process.send / 'message').
 * 4. Channel receives events via process.on('message') and dispatches to
 *    its local RegistryEventBus.
 *
 * Daemon-authoritative invariant (CONSTRAINT-D12):
 * - Only Daemon sends RegistryEvents (via send()).
 * - Channel only receives (via onMessage callback).
 * - Channel cannot inject identity claims through IPC.
 *
 * AT-7 closure:
 * - AT-7a (Ghost Agent): Channel receives events only; cannot emit agent:spawned.
 * - AT-7b (Shadow Agent): Daemon deduplicates before calling send().
 * - AT-7c (Identity Split): Daemon serializes terminate-before-spawn in send() order.
 */

import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { RegistryEvent, ReadySignal } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("ChannelIpc");

/** Default timeout for waiting on READY signal (ms). */
const DEFAULT_READY_TIMEOUT_MS = 10_000;

export interface ChannelIpcOptions {
  /** Absolute path to Channel entry script (compiled JS). */
  channelEntryPath: string;
  /** Timeout for waiting on READY signal (ms). Default: 10000. */
  readyTimeoutMs?: number;
  /** Environment variables to pass to Channel process. */
  env?: Record<string, string>;
  /** Arguments to pass to Channel entry script. */
  args?: string[];
}

/**
 * ChannelIpc — manages the fork IPC channel to the Channel process.
 *
 * Daemon-side only. Channel receives events passively via process.on('message').
 */
export class ChannelIpc {
  private child: ChildProcess | null = null;
  private ready = false;
  private readySignal: ReadySignal | null = null;
  private readonly readyTimeoutMs: number;

  constructor(private readonly options: ChannelIpcOptions) {
    this.readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  }

  /**
   * Fork the Channel process and wait for the READY signal.
   *
   * AC-W3-1: Daemon does NOT forward spawn events until READY is received.
   * Returns the parsed ReadySignal for Daemon bookkeeping.
   */
  async start(): Promise<ReadySignal> {
    const child = fork(this.options.channelEntryPath, this.options.args ?? [], {
      // IPC channel enabled by default with fork()
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, ...this.options.env },
    });

    this.child = child;

    // Wait for READY signal on stdout (AC-W3-1, CONSTRAINT-D13).
    const readySignal = await this.waitForReady(child);
    this.ready = true;
    this.readySignal = readySignal;

    logger.info(
      `ChannelIpc ready: channelId="${readySignal.channelId}" version=${readySignal.version}`,
    );

    return readySignal;
  }

  /**
   * Send a RegistryEvent to the Channel process over the IPC channel.
   *
   * Daemon-authoritative: only Daemon calls this. Channel cannot reverse the flow.
   * If Channel is not ready, the event is dropped with a warning.
   */
  send(event: RegistryEvent): void {
    if (!this.ready || !this.child || !this.child.connected) {
      logger.warn(`ChannelIpc.send() called before ready or after disconnect; event dropped.`);
      return;
    }
    this.child.send(event);
  }

  /**
   * Terminate the Channel process.
   */
  terminate(): void {
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
    this.ready = false;
  }

  /** Check if the IPC channel is ready. */
  isReady(): boolean {
    return this.ready;
  }

  /** The parsed READY signal (null before ready). */
  getReadySignal(): ReadySignal | null {
    return this.readySignal;
  }

  /**
   * Wait for the Channel process to emit a ReadySignal on stdout.
   * Rejects after readyTimeoutMs if no valid READY signal is received.
   */
  private waitForReady(child: ChildProcess): Promise<ReadySignal> {
    return new Promise<ReadySignal>((resolve, reject) => {
      let buffer = '';

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`ChannelIpc: READY signal timeout after ${this.readyTimeoutMs}ms`));
      }, this.readyTimeoutMs);

      const onData = (chunk: Buffer | string) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed: unknown = JSON.parse(trimmed);
            if (
              typeof parsed === 'object' &&
              parsed !== null &&
              (parsed as Record<string, unknown>).type === 'READY'
            ) {
              cleanup();
              resolve(parsed as ReadySignal);
              return;
            }
          } catch {
            // Non-JSON stdout line — ignore (could be logger output)
          }
        }
      };

      const onError = (err: Error) => {
        cleanup();
        reject(new Error(`ChannelIpc: Channel process error: ${err.message}`));
      };

      const onExit = (code: number | null) => {
        cleanup();
        reject(new Error(`ChannelIpc: Channel process exited (code=${code}) before READY`));
      };

      function cleanup() {
        clearTimeout(timeout);
        child.stdout?.off('data', onData);
        child.off('error', onError);
        child.off('exit', onExit);
      }

      child.stdout?.on('data', onData);
      child.on('error', onError);
      child.on('exit', onExit);
    });
  }
}

// ---------------------------------------------------------------------------
// Channel-side IPC receiver (runs inside the Channel process)
// ---------------------------------------------------------------------------

/**
 * listenForRegistryEvents — Channel-side IPC receiver.
 *
 * Call this inside the Channel entry point to receive RegistryEvents from
 * the Daemon's ChannelIpc.send(). Dispatches events to the local
 * RegistryEventBus via the provided handler.
 *
 * Channel-side only. Never call from Daemon side.
 *
 * Returns a cleanup function to remove the listener.
 */
export function listenForRegistryEvents(
  onEvent: (event: RegistryEvent) => void,
): () => void {
  const handler = (message: unknown) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      'agentId' in message &&
      'timestamp' in message
    ) {
      onEvent(message as RegistryEvent);
    }
  };

  process.on('message', handler);

  return () => {
    process.off('message', handler);
  };
}
