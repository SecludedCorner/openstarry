/**
 * CommRouter — deterministic routing logic for multi-agent communication.
 *
 * Pure function, zero side effects, zero I/O. Lives in SDK layer.
 * Local target → PipelineChannel; remote target → McpHubChannel.
 *
 * MECHANISM: routing decision is non-configurable (Rule #41 candidate).
 * Plan38 C7 (D4-R1).
 */

export interface CommRouteDecision {
  channel: 'pipeline' | 'mcp-hub';
  reason: string;
}

export type AgentLookupFn = (agentId: string) => boolean;

/**
 * Determine which channel to use for a message to the given target.
 *
 * @param targetAgentId - The target agent to route to.
 * @param isLocalAgent - Function that returns true if the target is in the same process tree.
 * @returns CommRouteDecision indicating which channel type to use.
 */
export function routeMessage(
  targetAgentId: string,
  isLocalAgent: AgentLookupFn,
): CommRouteDecision {
  if (isLocalAgent(targetAgentId)) {
    return { channel: 'pipeline', reason: 'target is local (same process tree)' };
  }
  return { channel: 'mcp-hub', reason: 'target is remote (cross-process)' };
}
