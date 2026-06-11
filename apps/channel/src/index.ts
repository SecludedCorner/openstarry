/**
 * openstarry-channel — standalone multi-agent communication hub process.
 *
 * Plan38 C4: Core Process.
 * - Standalone Node.js process, independent from Daemon.
 * - Dual MCP role: loads mcp-server + mcp-client plugins.
 * - READY signal via stdout after initialization (Plan39 W3: structured JSON).
 * - Lifecycle: RUNNING → DRAINING → TERMINATED.
 *
 * MECHANISM: Process lifecycle is non-bypassable.
 * POLICY: Timeout/grace values use SDK DEFAULT_* constants.
 *
 * Tenet #7: This package contains ZERO core package imports.
 */

import {
  DEFAULT_CHANNEL_HEARTBEAT_INTERVAL_MS,
  DEFAULT_CHANNEL_GRACE_PERIOD_MS,
} from "@openstarry/sdk";
import type { ChannelProcessState, ReadySignal } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";
import { AgentRegistry } from "./registry.js";
import { handleAgentCrash } from "./crash-handler.js";
import { RegistryEventBus } from "./registry-event-bus.js";
import { RegistryBridge } from "./registry-bridge.js";

export type { ChannelProcessState };

const logger = createLogger("openstarry-channel");

/** Version string for READY signal (Plan39 W3, AC-W3-1). */
const CHANNEL_VERSION = '0.39.0-alpha';

export interface ChannelConfig {
  channelId: string;
  heartbeatIntervalMs?: number;
  gracePeriodMs?: number;
  readyTimeoutMs?: number;
}

/**
 * OpenStarry Channel — the multi-agent communication hub.
 */
export class Channel {
  readonly registry = new AgentRegistry();
  readonly channelId: string;
  /** PROVISIONAL event bus for Daemon→Channel registry sync (Plan39 W3). */
  readonly eventBus: RegistryEventBus;
  /** PROVISIONAL registry bridge (Plan39 W3). */
  readonly bridge: RegistryBridge;
  private state: ChannelProcessState = 'STARTING';
  private heartbeatIntervalMs: number;
  private gracePeriodMs: number;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: ChannelConfig) {
    this.channelId = config.channelId;
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? DEFAULT_CHANNEL_HEARTBEAT_INTERVAL_MS;
    this.gracePeriodMs = config.gracePeriodMs ?? DEFAULT_CHANNEL_GRACE_PERIOD_MS;
    this.eventBus = new RegistryEventBus();
    this.bridge = new RegistryBridge(this.eventBus, this.registry, config.channelId);
  }

  getState(): ChannelProcessState {
    return this.state;
  }

  /**
   * Start the channel. Transitions STARTING → RUNNING.
   * Emits structured READY JSON on stdout (Plan39 W3, AC-W3-1, CONSTRAINT-D13).
   *
   * The READY signal format is ReadySignal JSON (SDK type), which Daemon
   * parses to confirm the Channel is ready before forwarding spawn events.
   *
   * After emitting READY, attaches the RegistryBridge to begin receiving
   * Daemon-attested registry events over the IPC channel.
   */
  async start(): Promise<void> {
    if (this.state !== 'STARTING') {
      throw new Error(`Cannot start channel in state "${this.state}"`);
    }

    // Start heartbeat monitor
    this.registry.startHeartbeatMonitor(
      (agentId) => {
        handleAgentCrash(this.registry, agentId, 'heartbeat timeout').catch(err => {
          logger.error(`Crash handler failed for ${agentId}`, { error: err });
        });
      },
      this.heartbeatIntervalMs,
    );

    this.state = 'RUNNING';

    // Emit structured READY signal (Plan39 W3, AC-W3-1, CONSTRAINT-D13).
    // Daemon waits for this JSON line before forwarding spawn events.
    const readySignal: ReadySignal = {
      type: 'READY',
      channelId: this.channelId,
      timestamp: Date.now(),
      version: CHANNEL_VERSION,
    };
    process.stdout.write(JSON.stringify(readySignal) + '\n');

    // Mark event bus ready and attach bridge subscriptions.
    this.eventBus.setReady(true);
    this.bridge.attach();

    logger.info(`Channel "${this.channelId}" started (heartbeat: ${this.heartbeatIntervalMs}ms)`);
  }

  /**
   * Initiate graceful shutdown. Transitions RUNNING → DRAINING → TERMINATED.
   */
  async shutdown(): Promise<void> {
    if (this.state === 'TERMINATED' || this.state === 'DRAINING') return;

    this.state = 'DRAINING';
    logger.info(`Channel "${this.channelId}" draining (grace: ${this.gracePeriodMs}ms)`);

    // Stop accepting new registrations, allow in-flight messages to complete
    this.registry.stopHeartbeatMonitor();
    this.bridge.dispose();
    this.eventBus.setReady(false);

    // Grace period: wait for in-flight messages
    await new Promise<void>(resolve => {
      this.drainTimer = setTimeout(resolve, this.gracePeriodMs);
    });

    this.state = 'TERMINATED';
    logger.info(`Channel "${this.channelId}" terminated`);
  }

  /** Force-terminate without grace period. */
  forceTerminate(): void {
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.registry.stopHeartbeatMonitor();
    this.bridge.dispose();
    this.eventBus.setReady(false);
    this.state = 'TERMINATED';
    logger.info(`Channel "${this.channelId}" force-terminated`);
  }
}

// Re-export for consumers
export { AgentRegistry, RWLock } from "./registry.js";
export type { ChannelAgentEntry, AgentCapabilities, AgentHealthState } from "./registry.js";
export { handleAgentCrash } from "./crash-handler.js";
export type { CrashEvent } from "./crash-handler.js";
export { RegistryEventBus } from "./registry-event-bus.js";
export { RegistryBridge } from "./registry-bridge.js";
export * from "./tools/index.js";
