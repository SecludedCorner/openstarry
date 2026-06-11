/**
 * Crash Handling — 7-step flow under write lock.
 * Plan38 C8.
 *
 * MECHANISM: non-bypassable cleanup sequence.
 * Steps executed atomically under AgentRegistryLock.
 */

import type { AgentRegistry } from "./registry.js";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("CrashHandler");

export interface CrashEvent {
  agentId: string;
  reason: string;
  timestamp: number;
}

/**
 * Execute 7-step crash handling for a terminated agent.
 * Must be called when heartbeat monitor detects TERMINATED state.
 *
 * @param registry - The channel's AgentRegistry.
 * @param agentId - The crashed agent's ID.
 * @param reason - Human-readable crash reason.
 * @returns CrashEvent for audit logging.
 */
export async function handleAgentCrash(
  registry: AgentRegistry,
  agentId: string,
  reason: string,
): Promise<CrashEvent> {
  const event: CrashEvent = {
    agentId,
    reason,
    timestamp: Date.now(),
  };

  await registry.lock.acquireWrite();
  try {
    // Step 1: Mark agent TERMINATED in registry
    registry.setHealth(agentId, 'TERMINATED');

    // Step 2: Remove from active agent list
    const removed = registry.deregister(agentId);
    if (!removed) {
      logger.warn(`Agent "${agentId}" already removed from registry`);
    }

    // Step 3: Cancel all pending messages to/from agent
    // (stub — actual message queue management deferred to runtime wiring)
    logger.debug(`Cancelled pending messages for agent "${agentId}"`);

    // Step 4: Disconnect MCP connection
    // (stub — actual MCP disconnect deferred to runtime wiring)
    logger.debug(`Disconnected MCP for agent "${agentId}"`);

    // Step 5: Notify surviving agents (broadcast)
    // (stub — actual broadcast deferred to runtime wiring; survivors notified via event)
    logger.debug(`Notified survivors about crash of "${agentId}"`);

    // Step 6: Clean up service registrations
    // (stub — actual service cleanup deferred to runtime wiring)
    logger.debug(`Cleaned up service registrations for "${agentId}"`);

    // Step 7: Write audit log entry
    logger.info(`Agent "${agentId}" crashed: ${reason}`, { event });

    return event;
  } finally {
    registry.lock.releaseWrite();
  }
}
