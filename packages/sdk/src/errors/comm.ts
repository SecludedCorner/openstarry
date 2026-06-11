/**
 * Communication-related error types — Plan38.
 */

import { AgentError } from "./base.js";

/** Reason codes for spawn denial. */
export type SpawnDeniedReason =
  | 'PATH_TRAVERSAL'
  | 'PATH_SUBSET_VIOLATION'
  | 'BUDGET_EXCEEDED'
  | 'CEILING_EXCEEDED'
  | 'CAPABILITY_VIOLATION'
  | 'DEPTH_EXCEEDED'
  | 'DRAINING';

/**
 * Thrown when spawnChildAgent is denied by the permission lattice.
 * Plan38 C11 (F-5).
 */
export class SpawnDeniedError extends AgentError {
  constructor(
    public readonly parentId: string,
    public readonly reason: SpawnDeniedReason,
    public readonly detail?: string,
  ) {
    super(
      `Spawn denied for parent "${parentId}": ${reason}${detail ? ` — ${detail}` : ''}`,
      "SPAWN_DENIED",
    );
    this.name = "SpawnDeniedError";
  }
}

/**
 * Thrown when a circuit breaker is OPEN for the target agent.
 * Plan38 C10 L2.
 */
export class CircuitBreakerError extends AgentError {
  constructor(
    public readonly targetAgentId: string,
    public readonly state: 'OPEN' | 'HALF_OPEN',
  ) {
    super(
      `Circuit breaker ${state} for target "${targetAgentId}"`,
      "CIRCUIT_BREAKER_OPEN",
    );
    this.name = "CircuitBreakerError";
  }
}

/**
 * Thrown when bulkhead capacity is exhausted for the target agent.
 * Plan38 C10 L3.
 */
export class BulkheadRejectError extends AgentError {
  constructor(
    public readonly targetAgentId: string,
    public readonly currentConcurrent: number,
    public readonly maxConcurrent: number,
  ) {
    super(
      `Bulkhead full for target "${targetAgentId}": ${currentConcurrent}/${maxConcurrent} concurrent`,
      "BULKHEAD_REJECT",
    );
    this.name = "BulkheadRejectError";
  }
}

/**
 * Thrown when message rate limit is exceeded.
 * Plan38 C16.
 */
export class RateLimitError extends AgentError {
  constructor(
    public readonly agentId: string,
    public readonly targetAgentId: string | undefined,
    public readonly limitType: 'per-agent' | 'per-target',
    public readonly currentRate: number,
    public readonly maxRate: number,
  ) {
    super(
      `Rate limit exceeded (${limitType}) for agent "${agentId}"${targetAgentId ? ` → "${targetAgentId}"` : ''}: ${currentRate}/${maxRate} msg/sec`,
      "RATE_LIMIT_EXCEEDED",
    );
    this.name = "RateLimitError";
  }
}
