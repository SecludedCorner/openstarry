/**
 * SEC-002 — PID-to-agentId identity verification utility.
 * Plan38 W0 C1.
 *
 * Prevents identity impersonation: an agent process can only claim the
 * agentId that was assigned to its PID at spawn time.
 *
 * MECHANISM: fail-closed (Rule #29). PID mismatch -> reject.
 * Used by: W1 register_agent step 5, daemon service.register.
 */

/**
 * Verify that a PID is the legitimate owner of a claimed agentId.
 *
 * @param pid - PID of the calling process.
 * @param claimedAgentId - agentId the caller claims to own.
 * @param pidToAgentMap - Map populated at spawn time (pid -> agentId).
 * @returns true if PID matches the expected agentId.
 * @returns false if PID is unknown or mapped to a different agentId (fail-closed).
 */
export function verifyAgentIdentity(
  pid: number,
  claimedAgentId: string,
  pidToAgentMap: ReadonlyMap<number, string>,
): boolean {
  const mappedAgentId = pidToAgentMap.get(pid);
  if (mappedAgentId === undefined) {
    return false;
  }
  return mappedAgentId === claimedAgentId;
}

/**
 * Remove a PID entry from the identity map on agent termination.
 * Prevents memory leak and stale mappings (Rule #29).
 *
 * @param pid - PID to remove.
 * @param pidToAgentMap - Mutable map to update.
 */
export function removePidIdentity(
  pid: number,
  pidToAgentMap: Map<number, string>,
): void {
  pidToAgentMap.delete(pid);
}
