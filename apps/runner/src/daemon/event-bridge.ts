import { createLogger } from "@openstarry/shared";

const logger = createLogger("EventBridge");

/**
 * Coordination message types for multi-agent lifecycle events (D2-R7).
 */
export type CoordinationMessageType =
  | 'agent:joining'
  | 'agent:leaving'
  | 'agent:status_changed';

export interface CoordinationMessage {
  type: CoordinationMessageType;
  agentId: string;
  timestamp: number;
  payload?: unknown;
}

/**
 * EventBridge — cross-agent event forwarding service.
 *
 * Sits in the Daemon layer. Agents' comm plugins selectively forward
 * events to EventBridge via IPC.
 *
 * Fail-open: EventBridge failure does not affect per-Agent EventBus (Rule #29).
 * EventBridge is an observational component.
 *
 * Plan37 C12, D2-R7.
 */
export class EventBridge {
  /** Map<eventType, Set<agentId>> — subscription table */
  private subscriptions: Map<string, Set<string>> = new Map();
  /** Map<agentId, Set<eventType>> — per-agent whitelist from agent.json */
  private whitelists: Map<string, Set<string>> = new Map();
  /** Callback to deliver events to agents */
  private deliverFn: ((agentId: string, event: CoordinationMessage) => void) | null = null;

  /** Set the delivery function (called by daemon to wire IPC delivery). */
  setDeliveryFn(fn: (agentId: string, event: CoordinationMessage) => void): void {
    this.deliverFn = fn;
  }

  /** Register an agent with its event subscription whitelist. */
  registerAgent(agentId: string, eventSubscriptions: string[]): void {
    const whitelist = new Set(eventSubscriptions);
    this.whitelists.set(agentId, whitelist);

    for (const eventType of eventSubscriptions) {
      if (!this.subscriptions.has(eventType)) {
        this.subscriptions.set(eventType, new Set());
      }
      this.subscriptions.get(eventType)!.add(agentId);
    }
  }

  /** Deregister an agent (cleanup on terminate). */
  deregisterAgent(agentId: string): void {
    const whitelist = this.whitelists.get(agentId);
    if (whitelist) {
      for (const eventType of whitelist) {
        this.subscriptions.get(eventType)?.delete(agentId);
      }
    }
    this.whitelists.delete(agentId);
  }

  /**
   * Publish a coordination event to all subscribed agents.
   * Fail-open: delivery errors are logged but never thrown.
   */
  publish(event: CoordinationMessage): void {
    const subscribers = this.subscriptions.get(event.type);
    if (!subscribers || subscribers.size === 0) return;

    for (const agentId of subscribers) {
      if (agentId === event.agentId) continue;

      try {
        this.deliverFn?.(agentId, event);
      } catch (err) {
        logger.warn(`EventBridge delivery failed for ${agentId}: ${(err as Error).message}`);
      }
    }
  }

  /** Get all subscribers for an event type. */
  getSubscribers(eventType: string): string[] {
    return Array.from(this.subscriptions.get(eventType) ?? []);
  }
}
