/**
 * supervisor — restart-strategy selection for crashed child agents
 * (Fractal Society; SupervisorStrategy was type+constant only until now).
 *
 * The daemon supervises the children IT spawned (one supervision group per
 * daemon, since 1 daemon = 1 agent). When a supervised child's OS process is
 * detected dead while its registry status is still 'running' (i.e. it CRASHED,
 * not gracefully stopped), the daemon restarts a set of children chosen by the
 * crashed child's strategy. This module is the PURE selection — the restart
 * orchestration (spawn, registry bookkeeping) lives in daemon-entry.
 */

import type { SupervisorStrategy } from "@openstarry/sdk";

export interface SupervisionEntry {
  /** Restart strategy for this child's supervision group. */
  strategy: SupervisorStrategy;
  /** Max restarts before the daemon gives up supervising this child. */
  maxRestarts: number;
  /** Restarts performed so far. */
  restartCount: number;
  /** Monotonic supervise order — defines "started after" for rest-for-one. */
  order: number;
}

/**
 * Given a crashed supervised child and the active supervision map, return the
 * ordered set of child agentIds to restart, per the crashed child's strategy:
 *   - one-for-one : just the crashed child.
 *   - one-for-all : every child in the supervision group.
 *   - rest-for-one: the crashed child + every child supervised AFTER it.
 * Pure: no side effects, deterministic. Returns [] if the child is unknown.
 */
export function selectRestartSet(
  deadAgentId: string,
  supervised: ReadonlyMap<string, SupervisionEntry>,
): string[] {
  const dead = supervised.get(deadAgentId);
  if (!dead) return [];
  switch (dead.strategy) {
    case "one-for-one":
      return [deadAgentId];
    case "one-for-all":
      return [...supervised.entries()].sort((a, b) => a[1].order - b[1].order).map(([id]) => id);
    case "rest-for-one":
      return [...supervised.entries()]
        .filter(([, e]) => e.order >= dead.order)
        .sort((a, b) => a[1].order - b[1].order)
        .map(([id]) => id);
    default:
      return [deadAgentId];
  }
}

/** True if this child may still be restarted (restart budget not exhausted). */
export function withinRestartBudget(entry: SupervisionEntry): boolean {
  return entry.restartCount < entry.maxRestarts;
}
