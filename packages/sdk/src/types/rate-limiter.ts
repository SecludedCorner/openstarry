/**
 * Dual rate limiter types — Plan38 W5.
 *
 * FROZEN: Architecture_Spec Plan38, Cycle 20260328_cycle03-2.
 * @since v0.38.0-alpha
 */

/**
 * Single token bucket instance — implements the token bucket algorithm.
 * Algorithm: MECHANISM (non-bypassable). Rate values: POLICY.
 *
 * FROZEN: Architecture_Spec Plan38, Cycle 20260328_cycle03-2.
 * @since v0.38.0-alpha
 */
export interface TokenBucket {
  /**
   * Attempt to consume one token.
   * @returns true if a token was available (request allowed); false if rate limit exceeded.
   */
  tryConsume(): boolean;

  /**
   * Current number of available tokens (for diagnostics).
   */
  readonly availableTokens: number;

  /**
   * Maximum tokens (= rate limit in tokens/window). POLICY.
   */
  readonly maxTokens: number;
}

/**
 * IDualRateLimiter — dual-level token bucket rate limiter.
 *
 * Enforces two independent constraints simultaneously:
 *   1. Per-agent total: rate(sender, t) <= R_agent (DEFAULT_RATE_LIMIT_PER_AGENT)
 *   2. Per-target: rate(sender -> target, t) <= R_target (DEFAULT_RATE_LIMIT_PER_TARGET)
 *
 * BABBAGE formal constraint:
 *   forall t: rate(sender, t) <= R_target AND sum_t(rate(sender, t)) <= R_agent
 *
 * Overflow: throws RateLimitError (fail-closed, Rule #29).
 * Defends against: AT-3a (message flood), AT-3b (EventBridge flood).
 *
 * FROZEN: Architecture_Spec Plan38, Cycle 20260328_cycle03-2.
 * @since v0.38.0-alpha
 */
export interface IDualRateLimiter {
  /**
   * Check and consume rate limit tokens for a send operation.
   * Checks per-agent bucket first, then per-target bucket.
   * @throws RateLimitError if either limit is exceeded.
   */
  checkAndConsume(agentId: string, targetAgentId: string): void;

  /**
   * Get per-agent bucket for a given agent (for diagnostics).
   */
  getAgentBucket(agentId: string): TokenBucket;

  /**
   * Get per-target bucket for a given (agent, target) pair (for diagnostics).
   */
  getTargetBucket(agentId: string, targetAgentId: string): TokenBucket;

  /**
   * Remove all buckets for an agent (called on deregister/crash).
   */
  clearAgent(agentId: string): void;
}
