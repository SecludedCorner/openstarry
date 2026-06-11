/**
 * deregister_agent — graceful removal from channel.
 * Plan38 C6b.
 * Gate: sender = self only (cannot deregister other agents).
 */

import type { AgentRegistry } from "../registry.js";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("deregister_agent");

export interface DeregisterParams {
  agentId: string;
  callerId: string;
}

export async function deregisterAgent(
  registry: AgentRegistry,
  params: DeregisterParams,
): Promise<{ success: boolean; reason?: string }> {
  // Gate: only self-deregister allowed
  if (params.callerId !== params.agentId) {
    return { success: false, reason: `Agent "${params.callerId}" cannot deregister "${params.agentId}" (self-only)` };
  }

  await registry.lock.acquireWrite();
  try {
    const entry = registry.deregister(params.agentId);
    if (!entry) {
      return { success: false, reason: `Agent "${params.agentId}" not registered` };
    }

    // Audit log: record graceful deregistration (C8 cleanup, step 7 equivalent)
    logger.info(`Agent "${params.agentId}" deregistered gracefully`, {
      agentId: params.agentId,
      timestamp: Date.now(),
    });

    // Notify surviving agents that this agent has deregistered
    // (stub — actual broadcast deferred to runtime wiring; Plan39 will wire real IPC notifications)
    const survivors = registry.list().map(a => a.agentId);
    logger.debug(`Notifying ${survivors.length} surviving agent(s) of deregistration of "${params.agentId}": [${survivors.join(", ")}]`);

    // MCP disconnect stub — Plan39 will add real transport disconnect
    // TODO(Plan39): close MCP Server connection for agentId="${params.agentId}"
    logger.debug(`MCP disconnect stub for "${params.agentId}" (Plan39 will implement)`);

    return { success: true };
  } finally {
    registry.lock.releaseWrite();
  }
}
