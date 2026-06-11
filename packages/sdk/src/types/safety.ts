/**
 * Safety monitor configuration types and defaults.
 * Plan32 Wave 3: Externalized from Core to SDK.
 *
 * @module safety
 */

/** Safety monitor configuration — all fields required at Core level. */
export interface SafetyMonitorConfig {
  /** Max loop ticks per task */
  readonly maxLoopTicks: number;
  /** Max total token usage (0 = unlimited) */
  readonly maxTokenUsage: number;
  /** Consecutive identical failed tool calls to trigger breaker */
  readonly repetitiveFailThreshold: number;
  /** Consecutive failures before forcing "ask user for help" */
  readonly frustrationThreshold: number;
  /** Error rate window size */
  readonly errorWindowSize: number;
  /** Error rate threshold to trigger cascade breaker */
  readonly errorRateThreshold: number;
  /** SHA-256 fingerprint truncation length for repetitive call detection */
  readonly fingerprintLength: number;
}

/** SDK default safety monitor configuration. */
export const DEFAULT_SAFETY_MONITOR_CONFIG: SafetyMonitorConfig = {
  maxLoopTicks: 50,
  maxTokenUsage: 100000,
  repetitiveFailThreshold: 3,
  frustrationThreshold: 5,
  errorWindowSize: 10,
  errorRateThreshold: 0.8,
  fingerprintLength: 16,
};

/**
 * PostRouteCheck v2 policy defaults.
 * NEW IN v0.33.0-alpha (Plan33 D-31-1, RES-D2-2).
 *
 * These are policy values per BABBAGE continuity test — placed in SDK, not Core.
 */
export const DEFAULT_POST_ROUTE_MAX_TOKEN_BUDGET = Infinity;  // disabled by default
export const DEFAULT_POST_ROUTE_CONFIDENCE_FLOOR = 0;         // disabled by default
