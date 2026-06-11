/**
 * DualRateLimiter — per-agent and per-target rate limiting.
 * Plan38 C16 (D4-R5).
 *
 * Token bucket with sliding window.
 * MECHANISM: token bucket algorithm.
 * POLICY: rate limits are SDK DEFAULT_* constants.
 *
 * Defense-in-depth rationale (AC-W4-4, Plan39 W4):
 * Two rate limiters are active simultaneously — one per-agent, one per-target.
 * The per-agent limiter caps the total message volume from any single agent
 * regardless of target distribution. The per-target limiter caps directed
 * traffic between a specific sender-receiver pair. Neither limiter alone is
 * sufficient: an agent could saturate a target while staying under the global
 * cap, or spread a flood across many targets. Both layers must be enforced.
 */

import {
  DEFAULT_RATE_LIMIT_PER_AGENT,
  DEFAULT_RATE_LIMIT_PER_TARGET,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  RateLimitError,
} from "@openstarry/sdk";

export class DualRateLimiter {
  private perAgent = new Map<string, number[]>();
  private perTarget = new Map<string, Map<string, number[]>>();
  private readonly agentLimit: number;
  private readonly targetLimit: number;
  private readonly windowMs: number;

  constructor(config?: {
    agentLimit?: number;
    targetLimit?: number;
    windowMs?: number;
  }) {
    this.agentLimit = config?.agentLimit ?? DEFAULT_RATE_LIMIT_PER_AGENT;
    this.targetLimit = config?.targetLimit ?? DEFAULT_RATE_LIMIT_PER_TARGET;
    this.windowMs = config?.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
  }

  /**
   * Check and record a message send.
   * @throws RateLimitError if either limit is exceeded.
   */
  check(agentId: string, targetId?: string): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    // Per-agent check
    let agentTimestamps = this.perAgent.get(agentId);
    if (!agentTimestamps) {
      agentTimestamps = [];
      this.perAgent.set(agentId, agentTimestamps);
    }
    // Trim expired
    while (agentTimestamps.length > 0 && agentTimestamps[0] <= cutoff) {
      agentTimestamps.shift();
    }
    if (agentTimestamps.length >= this.agentLimit) {
      throw new RateLimitError(agentId, targetId, 'per-agent', agentTimestamps.length, this.agentLimit);
    }

    // Per-target check (if target specified)
    if (targetId) {
      let targetMap = this.perTarget.get(agentId);
      if (!targetMap) {
        targetMap = new Map();
        this.perTarget.set(agentId, targetMap);
      }
      let targetTimestamps = targetMap.get(targetId);
      if (!targetTimestamps) {
        targetTimestamps = [];
        targetMap.set(targetId, targetTimestamps);
      }
      while (targetTimestamps.length > 0 && targetTimestamps[0] <= cutoff) {
        targetTimestamps.shift();
      }
      if (targetTimestamps.length >= this.targetLimit) {
        throw new RateLimitError(agentId, targetId, 'per-target', targetTimestamps.length, this.targetLimit);
      }
      targetTimestamps.push(now);
    }

    agentTimestamps.push(now);
  }

  /** Clean up entries for a deregistered agent. */
  removeAgent(agentId: string): void {
    this.perAgent.delete(agentId);
    this.perTarget.delete(agentId);
  }
}
