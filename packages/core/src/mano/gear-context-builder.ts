/**
 * GearContext construction helper — builds GearContext from loop state.
 *
 * Pure function, no dependencies on Core internals.
 *
 * @skandha vijnana (識蘊)
 * @see Plan27b: P27-O GearContext construction
 */

import type {
  GearContext,
  GearToolCall,
  ActionRecord,
  AgentConfig,
  ToolCallRequest,
} from "@openstarry/sdk";

/**
 * Build a GearContext from ExecutionLoop state for ManoAggregator routing.
 */
export function buildGearContext(
  input: string,
  pendingToolCalls: readonly ToolCallRequest[],
  actionHistory: readonly ActionRecord[],
  agentConfig: AgentConfig,
  sessionId?: string,
): GearContext {
  const proposedToolCalls: GearToolCall[] = pendingToolCalls.map(tc => ({
    name: tc.name,
    arguments: tc.arguments,
  }));

  return {
    input,
    proposedToolCalls,
    actionHistory,
    agentConfig,
    sessionId,
  };
}
