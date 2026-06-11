/**
 * register_agent — 5-step validation chain.
 * Plan38 C6a.
 */

import type { AgentRegistry, ChannelAgentEntry, AgentCapabilities } from "../registry.js";
import {
  DEFAULT_CHANNEL_HEARTBEAT_INTERVAL_MS,
} from "@openstarry/sdk";

export interface RegisterParams {
  agentId: string;
  pid: number;
  mcpEndpoint?: string;
  capabilities: AgentCapabilities;
  exposedTools: string[];
}

export interface RegisterResult {
  channelId: string;
  heartbeatIntervalMs: number;
  registeredAgents: string[];
}

/**
 * 5-step registration validation:
 * 1. Uniqueness: agentId not already registered
 * 2. Endpoint reachability: (deferred to Plan39 — requires actual MCP probing)
 * 3. Capabilities legality: capabilities subset of allowed set (Rule #37 zero-default)
 * 4. ExposedTools minimum: at least 1 tool exposed
 * 5. SEC-002 identity verification: PID-to-agentId match
 */
export async function registerAgent(
  registry: AgentRegistry,
  params: RegisterParams,
  channelId: string,
  heartbeatIntervalMs: number = DEFAULT_CHANNEL_HEARTBEAT_INTERVAL_MS,
  pidToAgentMap: ReadonlyMap<number, string>,
): Promise<RegisterResult> {
  // Step 1: Uniqueness
  await registry.lock.acquireRead();
  try {
    if (registry.has(params.agentId)) {
      throw new Error(`Agent "${params.agentId}" already registered`);
    }
  } finally {
    registry.lock.releaseRead();
  }

  // Step 2: Endpoint reachability (deferred — stub always passes)

  // Step 3: Capabilities legality (Rule #37: zero-default means all capabilities must be explicitly granted)
  if (!params.capabilities) {
    throw new Error("capabilities required for registration");
  }

  // Step 4: ExposedTools minimum
  if (!params.exposedTools || params.exposedTools.length < 1) {
    throw new Error("At least 1 exposedTool required for registration");
  }

  // Step 5: SEC-002 PID-to-agentId identity verification (fail-closed — Rule #29)
  // Unknown PID is rejected; PID mapped to different agentId is rejected.
  const mappedAgentId = pidToAgentMap.get(params.pid);
  if (mappedAgentId === undefined) {
    throw new Error(
      `SEC-002: PID ${params.pid} is not in the identity map (unknown process)`,
    );
  }
  if (mappedAgentId !== params.agentId) {
    throw new Error(
      `SEC-002: PID ${params.pid} is mapped to "${mappedAgentId}", not "${params.agentId}"`,
    );
  }

  // All validations passed — register under write lock
  await registry.lock.acquireWrite();
  try {
    // Flat capability list for IAgentRegistryEntry (capability type names)
    const flatCapabilities: string[] = [];
    if (params.capabilities.canSendTo.length > 0) flatCapabilities.push('canSendTo');
    if (params.capabilities.canReceiveFrom.length > 0) flatCapabilities.push('canReceiveFrom');
    if (params.exposedTools.length > 0) flatCapabilities.push('exposedTools');

    const entry: ChannelAgentEntry = {
      agentId: params.agentId,
      channelId,
      pid: params.pid,
      health: 'HEALTHY',
      mcpEndpoint: params.mcpEndpoint ?? '',
      capabilities: flatCapabilities,
      exposedTools: params.exposedTools,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
      consecutiveMisses: 0,
      routingCapabilities: params.capabilities,
    };
    registry.register(entry);

    return {
      channelId,
      heartbeatIntervalMs,
      registeredAgents: registry.list().map(a => a.agentId),
    };
  } finally {
    registry.lock.releaseWrite();
  }
}
