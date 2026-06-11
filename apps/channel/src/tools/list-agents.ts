/**
 * list_agents — informational, fail-open per Rule #29.
 * Plan38 C6e.
 * Gate: None (informational).
 */

import type { AgentSummary } from "@openstarry/sdk";
import type { AgentRegistry } from "../registry.js";

export type { AgentSummary };

export async function listAgents(
  registry: AgentRegistry,
): Promise<AgentSummary[]> {
  await registry.lock.acquireRead();
  try {
    return registry.list().map(a => ({
      agentId: a.agentId,
      health: a.health,
    }));
  } finally {
    registry.lock.releaseRead();
  }
}
