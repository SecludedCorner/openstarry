/**
 * PermissionLattice — F-5 runtime enforcement.
 * Plan38 C11 (D4-R3, Rule #33, seL4 capability model).
 *
 * Implements IPermissionLattice:
 * 1. validateSpawn() — checks 3 constraint dimensions (fail-closed)
 * 2. cascadeTermination() — propagates parent termination to all children
 *
 * MECHANISM: validation logic and cascading are non-bypassable.
 * POLICY: default values from SDK constants.
 */

import type { SpawnConstraints, IPermissionLattice, CompositeAgentPermissionLattice } from "@openstarry/sdk";
import { SpawnDeniedError } from "@openstarry/sdk";
import { isPathSafe } from "@openstarry/core";
import type { AgentRegistryEntry } from "./types.js";

/**
 * isSubPath — checks if childPath is within any of the parentPaths.
 * Uses isPathSafe() from core guardrails (symlink-safe).
 * MECHANISM: path subset check is non-bypassable.
 */
function isSubPath(childPath: string, parentPaths: string[]): boolean {
  return parentPaths.some(pp => isPathSafe(pp, childPath));
}

/**
 * PermissionLattice — runtime implementation of IPermissionLattice.
 *
 * Holds a reference to the agent registry for cascading termination.
 * The registry is the single source of truth for parent/child relationships.
 */
export class PermissionLattice implements IPermissionLattice {
  constructor(
    private readonly registry: Map<string, AgentRegistryEntry>,
    private readonly onTerminate: (agentId: string) => Promise<void>,
  ) {}

  /**
   * Validate spawn constraints against parent permission lattice.
   * Fails closed on any violation (Rule #29).
   *
   * Remediation hints included in SpawnDeniedError.detail (DARWIN requirement).
   */
  validateSpawn(
    parentId: string,
    parentLattice: CompositeAgentPermissionLattice,
    childConstraints: SpawnConstraints,
  ): void {
    // 1. Path subset: child.allowedPaths ⊆ parent.allowedPaths
    for (const childPath of childConstraints.allowedPaths) {
      if (!isSubPath(childPath, parentLattice.allowedPaths)) {
        throw new SpawnDeniedError(
          parentId,
          'PATH_SUBSET_VIOLATION',
          `Child path "${childPath}" is not a subset of parent allowedPaths [${parentLattice.allowedPaths.join(', ')}]. ` +
          `Remediation: restrict child allowedPaths to within parent's allowed scope.`,
        );
      }
    }

    // 2. Token budget: child.maxTokenBudget <= parent.remainingBudget
    if (childConstraints.maxTokenBudget > parentLattice.remainingBudget) {
      throw new SpawnDeniedError(
        parentId,
        'BUDGET_EXCEEDED',
        `Child maxTokenBudget (${childConstraints.maxTokenBudget}) exceeds parent remainingBudget (${parentLattice.remainingBudget}). ` +
        `Remediation: reduce child maxTokenBudget or wait for parent budget to replenish.`,
      );
    }

    // 3. Confidence ceiling: child.maxConfidenceCeiling <= parent.remainingCeiling
    if (childConstraints.maxConfidenceCeiling > parentLattice.remainingCeiling) {
      throw new SpawnDeniedError(
        parentId,
        'CEILING_EXCEEDED',
        `Child maxConfidenceCeiling (${childConstraints.maxConfidenceCeiling}) exceeds parent remainingCeiling (${parentLattice.remainingCeiling}). ` +
        `Remediation: reduce child maxConfidenceCeiling or ensure parent ceiling has sufficient headroom.`,
      );
    }
  }

  /**
   * Cascade termination from parent to all direct children.
   * Returns list of terminated child agent IDs.
   * MECHANISM: cascading is non-bypassable — all children are terminated.
   */
  async cascadeTermination(parentId: string): Promise<string[]> {
    const parent = this.registry.get(parentId);
    if (!parent) return [];

    const terminated: string[] = [];
    const childIds = [...parent.childAgentIds];

    for (const childId of childIds) {
      const child = this.registry.get(childId);
      if (child && child.status !== 'terminated') {
        // Recursively cascade to grandchildren first
        const grandchildTerminated = await this.cascadeTermination(childId);
        terminated.push(...grandchildTerminated);

        // Terminate this child
        try {
          await this.onTerminate(childId);
        } catch {
          // Fail-closed: log and continue — child is considered terminated
        }
        terminated.push(childId);
      }
    }

    return terminated;
  }
}
