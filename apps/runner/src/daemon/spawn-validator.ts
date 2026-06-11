/**
 * Spawn Validator — F-5 Permission Lattice Runtime Enforcement.
 * Plan38 C11 (D4-R3, Rule #33).
 *
 * Validates 3 constraint dimensions for ICompositeAgent:
 * 1. Path subset: child's allowed paths ⊆ parent's allowed paths
 * 2. Token budget: child's budget <= parent's remaining budget
 * 3. Delta ceiling: child's confidence ceiling <= parent's current confidence
 *
 * Also validates depth limit and comm capabilities.
 *
 * MECHANISM: validation logic is non-bypassable.
 * POLICY: default values from SDK constants.
 */

import { COMPOSITE_AGENT_MAX_DEPTH, SpawnDeniedError } from "@openstarry/sdk";
import type { SpawnDeniedReason } from "@openstarry/sdk";
import type { IAgentConfig } from "@openstarry/sdk";
import { isPathSafe } from "@openstarry/core";
import { MessageRouter } from "./message-router.js";
import type { AgentCommCapabilities } from "./message-router.js";
import type { AgentRegistryEntry } from "./types.js";

export interface SpawnValidationInput {
  /** Parent agent registry entry. */
  parentEntry: AgentRegistryEntry;
  /** Child agent configuration. */
  childConfig: {
    agentId: string;
    configPath: string;
    allowedPaths?: string[];
    maxTokenBudget?: number;
    maxConfidenceCeiling?: number;
  };
  /** Child's loaded agent config (for comm capabilities). */
  childAgentConfig?: IAgentConfig;
  /** Current depth of parent in process tree. */
  parentDepth: number;
  /** Parent's remaining token budget. */
  parentRemainingBudget?: number;
  /** Parent's current confidence. */
  parentCurrentConfidence?: number;
  /** MessageRouter for capability validation. */
  messageRouter: MessageRouter;
}

/**
 * Validate all spawn constraints. Throws SpawnDeniedError on violation.
 */
export function validateSpawnConstraints(input: SpawnValidationInput): void {
  const {
    parentEntry,
    childConfig,
    childAgentConfig,
    parentDepth,
    parentRemainingBudget,
    parentCurrentConfidence,
    messageRouter,
  } = input;

  // 1. Depth check: current depth + 1 must not exceed COMPOSITE_AGENT_MAX_DEPTH
  if (parentDepth + 1 > COMPOSITE_AGENT_MAX_DEPTH) {
    throw new SpawnDeniedError(
      parentEntry.agentId,
      'DEPTH_EXCEEDED',
      `Depth ${parentDepth + 1} exceeds max ${COMPOSITE_AGENT_MAX_DEPTH}`,
    );
  }

  // 2. Path subset: child's allowedPaths must be subset of parent's
  if (childConfig.allowedPaths && childConfig.allowedPaths.length > 0) {
    const parentConfigDir = parentEntry.configPath;
    for (const childPath of childConfig.allowedPaths) {
      // Check each child path is within the parent's config directory scope
      if (!isPathSafe(parentConfigDir, childPath)) {
        throw new SpawnDeniedError(
          parentEntry.agentId,
          'PATH_SUBSET_VIOLATION',
          `Child path "${childPath}" is outside parent scope`,
        );
      }
    }
  }

  // 3. Token budget: child's budget must not exceed parent's remaining budget
  if (
    childConfig.maxTokenBudget !== undefined &&
    parentRemainingBudget !== undefined &&
    childConfig.maxTokenBudget > parentRemainingBudget
  ) {
    throw new SpawnDeniedError(
      parentEntry.agentId,
      'BUDGET_EXCEEDED',
      `Child budget ${childConfig.maxTokenBudget} > parent remaining ${parentRemainingBudget}`,
    );
  }

  // 4. Delta ceiling: child's confidence ceiling must not exceed parent's current confidence
  if (
    childConfig.maxConfidenceCeiling !== undefined &&
    parentCurrentConfidence !== undefined &&
    childConfig.maxConfidenceCeiling > parentCurrentConfidence
  ) {
    throw new SpawnDeniedError(
      parentEntry.agentId,
      'CEILING_EXCEEDED',
      `Child ceiling ${childConfig.maxConfidenceCeiling} > parent confidence ${parentCurrentConfidence}`,
    );
  }

  // 5. Comm capabilities: child ⊆ parent (Rule #33, seL4 capability model)
  if (childAgentConfig?.communication) {
    const parentCaps = messageRouter.getAgentCapabilities(parentEntry.agentId) ?? {
      canSendTo: [],
      canReceiveFrom: [],
      exposedTools: [],
    };
    // Rule #37: zero-capability default for child
    const childCaps: AgentCommCapabilities = {
      canSendTo: childAgentConfig.communication.canSendTo ?? [],
      canReceiveFrom: childAgentConfig.communication.canReceiveFrom ?? [],
      exposedTools: childAgentConfig.communication.exposedTools ?? [],
    };
    const capResult = messageRouter.validateChildCapabilities(parentCaps, childCaps);
    if (!capResult.allowed) {
      throw new SpawnDeniedError(
        parentEntry.agentId,
        'CAPABILITY_VIOLATION',
        capResult.reason,
      );
    }
  }
}

/**
 * Compute the depth of an agent in the process tree.
 * Returns 0 for root agents.
 */
export function computeAgentDepth(
  agentId: string,
  registry: Map<string, AgentRegistryEntry>,
): number {
  let depth = 0;
  let current = registry.get(agentId);
  while (current?.parentAgentId) {
    depth++;
    current = registry.get(current.parentAgentId);
    if (depth > COMPOSITE_AGENT_MAX_DEPTH + 1) break; // Safety guard
  }
  return depth;
}
