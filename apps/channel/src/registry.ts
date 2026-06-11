/**
 * AgentRegistry — in-memory registry of registered agents in the channel.
 *
 * Plan38 C5: 4-state health, heartbeat pull model, hot-join zero replay.
 * MECHANISM: state machine transitions are non-bypassable.
 */

import type { IAgentRegistryEntry, AgentHealthState } from "@openstarry/sdk";
import {
  DEFAULT_CHANNEL_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_MISS_THRESHOLD,
} from "@openstarry/sdk";

export type { AgentHealthState };

/** Communication capabilities declared at registration (channel-internal routing data). */
export interface AgentCapabilities {
  canSendTo: string[];
  canReceiveFrom: string[];
  exposedTools: string[];
}

/**
 * Channel-internal agent entry — extends IAgentRegistryEntry with structured routing data.
 * Satisfies the frozen SDK interface while storing canSendTo/canReceiveFrom for L3/L4 checks.
 */
export interface ChannelAgentEntry extends IAgentRegistryEntry {
  /** Structured routing capabilities (channel-internal, not in frozen SDK interface). */
  readonly routingCapabilities: AgentCapabilities;
}

/**
 * Simple async read-write lock.
 * Multiple readers OR one writer at a time.
 */
export class RWLock {
  private readers = 0;
  private writer = false;
  private waitQueue: Array<{ resolve: () => void; type: 'read' | 'write' }> = [];

  async acquireRead(): Promise<void> {
    if (!this.writer && !this.waitQueue.some(w => w.type === 'write')) {
      this.readers++;
      return;
    }
    return new Promise(resolve => this.waitQueue.push({ resolve, type: 'read' }));
  }

  releaseRead(): void {
    this.readers--;
    if (this.readers === 0) this.processQueue();
  }

  async acquireWrite(): Promise<void> {
    if (!this.writer && this.readers === 0) {
      this.writer = true;
      return;
    }
    return new Promise(resolve => this.waitQueue.push({ resolve, type: 'write' }));
  }

  releaseWrite(): void {
    this.writer = false;
    this.processQueue();
  }

  private processQueue(): void {
    if (this.waitQueue.length === 0) return;
    const next = this.waitQueue[0];
    if (next.type === 'write' && this.readers === 0 && !this.writer) {
      this.waitQueue.shift();
      this.writer = true;
      next.resolve();
    } else if (next.type === 'read' && !this.writer) {
      while (this.waitQueue.length > 0 && this.waitQueue[0].type === 'read') {
        const r = this.waitQueue.shift()!;
        this.readers++;
        r.resolve();
      }
    }
  }
}

/**
 * AgentRegistry with RWLock-protected concurrent access.
 */
export class AgentRegistry {
  private agents = new Map<string, ChannelAgentEntry>();
  readonly lock = new RWLock();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** Get an agent entry (caller must hold read lock). */
  get(agentId: string): ChannelAgentEntry | undefined {
    return this.agents.get(agentId);
  }

  /** Check if agent is registered (caller must hold read lock). */
  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /** List all registered agents (caller must hold read lock). */
  list(): ChannelAgentEntry[] {
    return Array.from(this.agents.values());
  }

  /** Register a new agent (caller must hold write lock). */
  register(entry: ChannelAgentEntry): void {
    this.agents.set(entry.agentId, entry);
  }

  /** Remove an agent from registry (caller must hold write lock). */
  deregister(agentId: string): ChannelAgentEntry | undefined {
    const entry = this.agents.get(agentId);
    this.agents.delete(agentId);
    return entry;
  }

  /** Update an agent's health (caller must hold write lock). */
  setHealth(agentId: string, health: AgentHealthState): void {
    const entry = this.agents.get(agentId);
    if (entry) entry.health = health;
  }

  /** Record a heartbeat for an agent (caller must hold write lock). */
  recordHeartbeat(agentId: string): void {
    const entry = this.agents.get(agentId);
    if (entry) {
      entry.lastHeartbeat = Date.now();
      entry.consecutiveMisses = 0;
      if (entry.health === 'DEGRADED' || entry.health === 'UNREACHABLE') {
        entry.health = 'HEALTHY';
      }
    }
  }

  /** Get agent count. */
  get size(): number {
    return this.agents.size;
  }

  /**
   * Start heartbeat monitoring (pull model).
   * Called once on channel start. Probes all agents on interval.
   */
  startHeartbeatMonitor(
    onAgentUnreachable: (agentId: string) => void,
    intervalMs: number = DEFAULT_CHANNEL_HEARTBEAT_INTERVAL_MS,
    missThreshold: number = DEFAULT_HEARTBEAT_MISS_THRESHOLD,
  ): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const entry of this.agents.values()) {
        if (entry.health === 'TERMINATED') continue;
        const elapsed = now - entry.lastHeartbeat;
        if (elapsed > intervalMs) {
          entry.consecutiveMisses++;
          if (entry.consecutiveMisses >= missThreshold) {
            entry.health = 'TERMINATED';
            onAgentUnreachable(entry.agentId);
          } else if (entry.consecutiveMisses >= 1) {
            entry.health = entry.consecutiveMisses >= 2 ? 'UNREACHABLE' : 'DEGRADED';
          }
        }
      }
    }, intervalMs);
  }

  /** Stop heartbeat monitor. */
  stopHeartbeatMonitor(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
