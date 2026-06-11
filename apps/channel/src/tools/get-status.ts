/**
 * get_agent_status — detailed info for capability-reachable agents.
 * Plan38 C6f.
 * Gate: canSendTo check (need-to-know per VITRUVIUS compromise).
 */

import type { AgentDetailedStatus, AgentHealthState } from "@openstarry/sdk";
import type { AgentRegistry } from "../registry.js";

export type { AgentDetailedStatus };

export async function getAgentStatus(
  registry: AgentRegistry,
  callerId: string,
  targetId: string,
): Promise<AgentDetailedStatus | { error: string }> {
  await registry.lock.acquireRead();
  try {
    const caller = registry.get(callerId);
    if (!caller) {
      return { error: `Caller "${callerId}" not registered` };
    }

    // canSendTo gate: caller must be able to reach target
    const callerCaps = caller.routingCapabilities;
    if (!callerCaps.canSendTo.includes(targetId) && !callerCaps.canSendTo.includes('*')) {
      return { error: `Caller "${callerId}" has no canSendTo capability for "${targetId}"` };
    }

    const target = registry.get(targetId);
    if (!target) {
      return { error: `Agent "${targetId}" not registered` };
    }

    const result: AgentDetailedStatus = {
      agentId: target.agentId,
      health: target.health,
      exposedTools: target.exposedTools,
      lastHeartbeat: target.lastHeartbeat,
      activeSessions: 0,
    };
    return result;
  } finally {
    registry.lock.releaseRead();
  }
}
