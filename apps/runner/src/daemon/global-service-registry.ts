import { createLogger } from "@openstarry/shared";

const logger = createLogger("GlobalServiceRegistry");

export interface ServiceRegistration {
  serviceName: string;
  agentId: string;
  metadata?: Record<string, unknown>;
  registeredAt: number;
}

/**
 * L2 Global ServiceRegistry — DNS-model service discovery.
 *
 * L1 (local) = per-agent ServiceRegistry (existing)
 * L2 (global) = this Daemon-level registry
 *
 * Query path: L1 local first -> L2 global via IPC
 * (like /etc/hosts -> DNS resolver)
 *
 * Auto-cleanup: services deregistered when agent terminates.
 * Independent of future Blackboard/Alaya — unified evaluation deferred to Plan39+ (D2-R7).
 *
 * Plan37 C13, D2-R7.
 */
export class GlobalServiceRegistry {
  /** Map<serviceName, ServiceRegistration[]> */
  private services: Map<string, ServiceRegistration[]> = new Map();

  /** Register a service provided by an agent. */
  register(serviceName: string, agentId: string, metadata?: Record<string, unknown>): void {
    const entry: ServiceRegistration = {
      serviceName,
      agentId,
      metadata,
      registeredAt: Date.now(),
    };

    const existing = this.services.get(serviceName) ?? [];
    const filtered = existing.filter(e => e.agentId !== agentId);
    filtered.push(entry);
    this.services.set(serviceName, filtered);
    logger.debug?.(`Registered service '${serviceName}' for agent '${agentId}'`);
  }

  /** Deregister all services provided by an agent (called on agent terminate). */
  deregisterAgent(agentId: string): void {
    for (const [name, entries] of this.services) {
      const filtered = entries.filter(e => e.agentId !== agentId);
      if (filtered.length === 0) {
        this.services.delete(name);
      } else {
        this.services.set(name, filtered);
      }
    }
  }

  /** Lookup a service by name. Returns all providers. */
  lookup(serviceName: string): ServiceRegistration[] {
    return this.services.get(serviceName) ?? [];
  }

  /** List all registered services. */
  listAll(): ServiceRegistration[] {
    const all: ServiceRegistration[] = [];
    for (const entries of this.services.values()) {
      all.push(...entries);
    }
    return all;
  }
}
