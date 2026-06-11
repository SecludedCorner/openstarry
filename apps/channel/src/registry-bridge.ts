/**
 * RegistryBridge — Daemon-authoritative event propagation to Channel registry.
 *
 * Plan39 W3: Daemon-authoritative bridge (~190 LOC target).
 *
 * Architecture (CONSTRAINT-D12, Daemon-authoritative invariant):
 * - Daemon is the single source of truth for agent identity and lifecycle.
 * - Channel registry is a READ REPLICA derived from Daemon-attested IPC events.
 * - Channel-originated identity claims (register without Daemon attestation) are
 *   REJECTED at the bridge layer. This closes AT-7a (Ghost Agent).
 * - Duplicate agentId on agent:spawned is rejected at bridge (AT-7b Shadow Agent).
 * - agent:terminated must be processed before agent:registered for same agentId
 *   (AT-7c Identity Split prevention — enforced by sequential IPC event ordering).
 *
 * Health advisory (CONSTRAINT-D12):
 * - agent:health_changed is ADVISORY — Channel may report health state changes.
 * - Identity and lifecycle (spawned/terminated/registered) are Daemon-authoritative.
 *
 * Lifecycle:
 * 1. Daemon forks Channel process.
 * 2. Channel emits structured READY on stdout.
 * 3. Daemon receives READY, marks bridge ready, begins forwarding spawn events.
 * 4. Bridge subscribes to all 4 event types and applies them to AgentRegistry.
 * 5. On shutdown, bridge is disposed (all subscriptions removed).
 */

import type { RegistryEvent, RegistryEventType } from "@openstarry/sdk";
import type { AgentRegistry, ChannelAgentEntry } from "./registry.js";
import type { RegistryEventBus } from "./registry-event-bus.js";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("RegistryBridge");

/** Minimum fields required on agent:spawned payload. */
interface SpawnedPayload {
  pid: number;
  mcpEndpoint?: string;
  capabilities?: readonly string[];
  exposedTools?: readonly string[];
}

/** Minimum fields required on agent:registered payload. */
interface RegisteredPayload {
  channelId?: string;
  pid?: number;
  mcpEndpoint?: string;
  capabilities?: readonly string[];
  exposedTools?: readonly string[];
}

/** Health-changed payload. */
interface HealthChangedPayload {
  health: 'HEALTHY' | 'DEGRADED' | 'UNREACHABLE' | 'TERMINATED';
}

/**
 * Type guard for SpawnedPayload.
 * AT-7b: we require pid at minimum to create a registry entry.
 */
function isSpawnedPayload(p: unknown): p is SpawnedPayload {
  return (
    typeof p === 'object' &&
    p !== null &&
    'pid' in p &&
    typeof (p as Record<string, unknown>).pid === 'number'
  );
}

function isRegisteredPayload(p: unknown): p is RegisteredPayload {
  return typeof p === 'object' && p !== null;
}

function isHealthChangedPayload(p: unknown): p is HealthChangedPayload {
  return (
    typeof p === 'object' &&
    p !== null &&
    'health' in p &&
    typeof (p as Record<string, unknown>).health === 'string'
  );
}

/**
 * RegistryBridge — connects RegistryEventBus to AgentRegistry.
 *
 * Daemon emits RegistryEvents → RegistryEventBus.emit() → RegistryBridge handlers
 * → AgentRegistry mutations (under write lock).
 *
 * INVARIANT: RegistryBridge never calls AgentRegistry.register() without a
 * Daemon-attested event. This closes AT-7a (Ghost Agent) by design.
 */
export class RegistryBridge {
  private readonly unsubscribers: Array<() => void> = [];
  private readonly channelId: string;

  constructor(
    private readonly bus: RegistryEventBus,
    private readonly registry: AgentRegistry,
    channelId: string,
  ) {
    this.channelId = channelId;
  }

  /**
   * Attach all event subscriptions.
   * Must be called after bus.isReady() returns true.
   */
  attach(): void {
    this.unsubscribers.push(
      this.bus.on('agent:spawned', (e) => this.onAgentSpawned(e)),
      this.bus.on('agent:terminated', (e) => this.onAgentTerminated(e)),
      this.bus.on('agent:registered', (e) => this.onAgentRegistered(e)),
      this.bus.on('agent:health_changed', (e) => this.onAgentHealthChanged(e)),
    );
    logger.info(`RegistryBridge attached for channel "${this.channelId}"`);
  }

  /**
   * Remove all event subscriptions and release resources.
   */
  dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;
    logger.info(`RegistryBridge disposed for channel "${this.channelId}"`);
  }

  /**
   * Handle agent:spawned — Daemon attests a new agent process exists.
   *
   * AT-7b: If agentId already exists in registry, this is a Shadow Agent attack.
   * We reject the duplicate and log a security warning.
   *
   * AT-7c: If the previous entry for this agentId was not TERMINATED, the
   * Identity Split window is open. We reject until a termination event clears it.
   */
  private onAgentSpawned(event: RegistryEvent): void {
    const { agentId, timestamp } = event;

    if (!isSpawnedPayload(event.payload)) {
      logger.warn(
        `agent:spawned for "${agentId}" missing required payload fields; event ignored.`,
      );
      return;
    }

    const payload = event.payload;

    // Build a minimal registry entry from Daemon-attested data.
    // health starts HEALTHY — Daemon has confirmed the process is alive.
    const entry: ChannelAgentEntry = {
      agentId,
      channelId: this.channelId,
      pid: payload.pid,
      health: 'HEALTHY',
      mcpEndpoint: payload.mcpEndpoint ?? '',
      capabilities: payload.capabilities ? [...payload.capabilities] : [],
      exposedTools: payload.exposedTools ? [...payload.exposedTools] : [],
      registeredAt: timestamp,
      lastHeartbeat: timestamp,
      consecutiveMisses: 0,
      routingCapabilities: {
        canSendTo: [],
        canReceiveFrom: [],
        exposedTools: payload.exposedTools ? [...payload.exposedTools] : [],
      },
    };

    // Apply under write lock (async, fire-and-forget — bridge operates synchronously
    // per IPC event delivery; lock acquisition failure is logged).
    this.registry.lock.acquireWrite().then(() => {
      try {
        // AT-7b: duplicate check UNDER write lock (SEC-001).
        // Moving has() inside the lock closes the TOCTOU window where two concurrent
        // agent:spawned events for the same agentId could both pass the check and
        // both proceed to register(), bypassing AT-7b Shadow Agent protection.
        if (this.registry.has(agentId)) {
          logger.warn(
            `[AT-7b] agent:spawned rejected — agentId "${agentId}" already in registry. ` +
            `Shadow Agent attack vector blocked.`,
          );
          return;
        }
        this.registry.register(entry);
        logger.info(`agent:spawned — registered "${agentId}" (pid=${payload.pid}) in read-replica.`);
      } finally {
        this.registry.lock.releaseWrite();
      }
    }).catch((err: unknown) => {
      logger.error(`agent:spawned write lock acquisition failed for "${agentId}"`, { error: err });
    });
  }

  /**
   * Handle agent:terminated — Daemon attests agent process has exited.
   *
   * AT-7c: Termination is processed before any subsequent registration
   * for the same agentId. IPC events are delivered in order, so if
   * agent:terminated arrives before agent:spawned for a re-spawned agent,
   * the registry is clean for the new entry.
   */
  private onAgentTerminated(event: RegistryEvent): void {
    const { agentId } = event;

    this.registry.lock.acquireWrite().then(() => {
      try {
        const removed = this.registry.deregister(agentId);
        if (removed) {
          logger.info(`agent:terminated — deregistered "${agentId}" from read-replica.`);
        } else {
          logger.warn(`agent:terminated for unknown agentId "${agentId}" — no entry to remove.`);
        }
      } finally {
        this.registry.lock.releaseWrite();
      }
    }).catch((err: unknown) => {
      logger.error(`agent:terminated write lock acquisition failed for "${agentId}"`, { error: err });
    });
  }

  /**
   * Handle agent:registered — Daemon attests agent has completed MCP registration.
   *
   * Updates existing entry with registration-time data (mcpEndpoint, capabilities).
   * If no entry exists (agent:spawned not yet processed), logs a warning but
   * does NOT create a new entry — Channel cannot self-register (AC-W3-3).
   *
   * CONSTRAINT-D12: Channel-originated identity claims are REJECTED.
   * This handler requires an existing Daemon-attested entry (from agent:spawned).
   */
  private onAgentRegistered(event: RegistryEvent): void {
    const { agentId } = event;

    if (!isRegisteredPayload(event.payload)) {
      logger.warn(`agent:registered for "${agentId}" missing payload; event ignored.`);
      return;
    }

    const payload = event.payload;

    this.registry.lock.acquireWrite().then(() => {
      try {
        const existing = this.registry.get(agentId);
        if (!existing) {
          // AC-W3-3: Channel CANNOT create an entry via agent:registered alone.
          // Daemon must have sent agent:spawned first.
          logger.warn(
            `[AC-W3-3] agent:registered for unknown "${agentId}" — ` +
            `no prior agent:spawned. Channel-originated identity claim rejected.`,
          );
          return;
        }

        // Update mutable registration fields on existing entry.
        if (payload.mcpEndpoint !== undefined) {
          (existing as { mcpEndpoint: string }).mcpEndpoint = payload.mcpEndpoint;
        }
        if (payload.capabilities !== undefined) {
          (existing as { capabilities: readonly string[] }).capabilities = [...payload.capabilities];
        }
        if (payload.exposedTools !== undefined) {
          (existing as { exposedTools: readonly string[] }).exposedTools = [...payload.exposedTools];
          existing.routingCapabilities.exposedTools = [...payload.exposedTools];
        }

        logger.info(`agent:registered — updated entry for "${agentId}" in read-replica.`);
      } finally {
        this.registry.lock.releaseWrite();
      }
    }).catch((err: unknown) => {
      logger.error(`agent:registered write lock acquisition failed for "${agentId}"`, { error: err });
    });
  }

  /**
   * Handle agent:health_changed — ADVISORY health update from Channel.
   *
   * CONSTRAINT-D12: Health state is advisory. The Channel may report
   * DEGRADED/UNREACHABLE from its heartbeat monitor; Daemon accepts this.
   * Identity and lifecycle decisions (terminated/spawned) remain Daemon-authoritative.
   */
  private onAgentHealthChanged(event: RegistryEvent): void {
    const { agentId } = event;

    if (!isHealthChangedPayload(event.payload)) {
      logger.warn(`agent:health_changed for "${agentId}" missing health field; event ignored.`);
      return;
    }

    const { health } = event.payload;

    this.registry.lock.acquireWrite().then(() => {
      try {
        if (!this.registry.has(agentId)) {
          logger.warn(`agent:health_changed for unknown "${agentId}" — no entry found.`);
          return;
        }
        this.registry.setHealth(agentId, health);
        logger.debug(`agent:health_changed — "${agentId}" health set to ${health}.`);
      } finally {
        this.registry.lock.releaseWrite();
      }
    }).catch((err: unknown) => {
      logger.error(`agent:health_changed write lock acquisition failed for "${agentId}"`, { error: err });
    });
  }
}

// ---------------------------------------------------------------------------
// AT-7 Attack Vector Closure Summary (CONSTRAINT-D12, AC-W3-5)
// ---------------------------------------------------------------------------
//
// AT-7a (Ghost Agent): Channel cannot call registry.register() without a
//   Daemon-attested agent:spawned event. onAgentRegistered() requires a prior
//   agent:spawned entry to exist — otherwise the event is rejected.
//
// AT-7b (Shadow Agent): onAgentSpawned() checks registry.has(agentId) UNDER the
//   write lock (SEC-001 TOCTOU fix). Duplicate agentId causes rejection with a SEC
//   warning. The check is inside the lock so two concurrent events cannot both pass.
//
// AT-7c (Identity Split): onAgentTerminated() deregisters before any new
//   agent:spawned for the same agentId can be processed. IPC events are
//   delivered in Daemon-controlled order; terminate-before-spawn is guaranteed
//   by the Daemon's own spawn lifecycle serialization.
