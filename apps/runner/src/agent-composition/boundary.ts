/**
 * agent-composition / boundary — Plan54 §4.3 boundary primitives.
 *
 *   1. Cryptographic boundary — each spawn re-signs `tokenSig` (HMAC-SHA256,
 *      fresh nonce, child-specific subject); parent's tokenSig NOT forwarded.
 *   2. Semantic boundary — child inherits `parentAgentId` in `sourceContext`
 *      for downstream policy plugins.
 *   3. Lineage integrity — recursive walk of `sourceContext.parentAgentId`
 *      (depth ≤ MAX_SPAWN_DEPTH); opaque to Core (MR-6 invariant).
 *   4. Capability containment — plugin policy decides; AC-9 provides
 *      mechanism only.
 *
 * @see openstarry_doc/Technical_Specifications/Plan54_AC9_Binding.md §4.3
 */

/** Lineage entry — one node in the parent → child chain. */
export interface LineageNode {
  readonly agentId: string;
  readonly spawnDepth: number;
  readonly spawnId?: string;
}

/**
 * Walk a `sourceContext`-style lineage chain, validating depth and detecting
 * loops. Used for forensic audit + boundary verification.
 *
 * Returns the chain as `[root, ..., leaf]` order. Throws if depth exceeded
 * or a cycle is detected (lineage MUST be a strict tree).
 */
export function walkLineage(
  leaf: LineageNode,
  resolveParent: (agentId: string) => LineageNode | null,
  maxDepth: number,
): readonly LineageNode[] {
  const chain: LineageNode[] = [leaf];
  const seen = new Set<string>([leaf.agentId]);
  let cursor = leaf;
  while (cursor.spawnDepth > 0) {
    if (chain.length > maxDepth + 1) {
      throw new Error(`agent-composition.boundary: lineage exceeded MAX_SPAWN_DEPTH=${maxDepth}`);
    }
    const parentId = `${cursor.agentId}__parent_unknown`; // resolver-provided
    const parent = resolveParent(cursor.agentId);
    if (!parent) {
      throw new Error(`agent-composition.boundary: parent unresolved for ${cursor.agentId}`);
    }
    if (seen.has(parent.agentId)) {
      throw new Error(`agent-composition.boundary: lineage cycle detected at ${parent.agentId}`);
    }
    seen.add(parent.agentId);
    chain.unshift(parent);
    cursor = parent;
    void parentId;
  }
  return chain;
}

/**
 * Pure check: is the requested child depth within bounds?
 *
 * Per Plan54 §7.4, exceeding triggers `SpawnChildResponse.reason = "max_spawn_depth_exceeded"`.
 */
export function isDepthAdmissible(parentDepth: number, maxDepth: number): boolean {
  return Number.isInteger(parentDepth) && parentDepth >= 0 && parentDepth + 1 <= maxDepth;
}

/**
 * Capability containment — does the parent's capability set permit the
 * requested child capability?
 *
 * Plan54 §4.3 sub-item 4: AC-9 provides mechanism only. The default check is
 * subset semantics (child capability ∈ parent capability set). Plugin policy
 * may override.
 */
export function isCapabilityContained(
  parentCapabilities: readonly string[],
  childCapability: string,
): boolean {
  return parentCapabilities.includes(childCapability);
}
