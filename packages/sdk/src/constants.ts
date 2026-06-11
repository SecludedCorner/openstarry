/**
 * SDK constants — exported from packages/sdk as the single source of truth.
 *
 * RULE: These constants MUST NOT be inlined in Core (MR-6).
 * RULE: Policy constants (POLICY) are configurable defaults;
 *       Mechanism constants (MECHANISM) are non-bypassable hard ceilings.
 */

/**
 * Maximum depth of a composite agent sub-tree.
 * MECHANISM ceiling: no agent may spawn children that would exceed depth 3 from root.
 * FROZEN: Spec Addendum (2026-03-24, Cycle 20260324_cycle03-1).
 */
export const COMPOSITE_AGENT_MAX_DEPTH = 3 as const;

/**
 * Default fraction of remaining token budget reservable for child agents.
 * POLICY: parent agents may configure a lower ratio.
 * SDK default: 30%.
 * FROZEN: Spec Addendum (2026-03-24, Cycle 20260324_cycle03-1).
 */
export const COMPOSITE_AGENT_DEFAULT_RESERVE_RATIO = 0.3 as const;

/**
 * Default supervisor strategy for child agents.
 * POLICY: configurable per parent agent.
 * FROZEN: Spec Addendum (2026-03-24, Cycle 20260324_cycle03-1).
 */
export const DEFAULT_SUPERVISOR_STRATEGY = 'one-for-one' as const;

/**
 * Maximum trace depth for CommMessage.traceDepth.
 * Messages with traceDepth > MAX_TRACE_DEPTH are rejected by the MessageRouter.
 * MECHANISM: non-bypassable ceiling.
 * FROZEN: Spec Addendum (2026-03-24) — from Doc 57.
 */
export const MAX_TRACE_DEPTH = 5 as const;

/**
 * Default grace period in milliseconds for graceful agent shutdown.
 * POLICY: configurable via IAgentConfig.communication.gracePeriodMs.
 * SDK default: 30 seconds.
 * FROZEN: Spec Addendum (2026-03-24, Cycle 20260324_cycle03-1).
 */
export const DEFAULT_AGENT_GRACE_PERIOD_MS = 30000 as const;

/**
 * Maximum allowed grace period in milliseconds.
 * MECHANISM ceiling: values above this are rejected at config validation time (not clamped).
 * FROZEN: Spec Addendum (2026-03-24, Cycle 20260324_cycle03-1).
 */
export const MAX_AGENT_GRACE_PERIOD_MS = 300000 as const;

// ─── Plan38 W1: openstarry-channel lifecycle ───

/** POLICY: READY signal timeout (30s default). */
export const DEFAULT_CHANNEL_READY_TIMEOUT_MS = 30000 as const;
/** MECHANISM: maximum READY signal timeout. */
export const MAX_CHANNEL_READY_TIMEOUT_MS = 60000 as const;
/** POLICY: heartbeat pull interval (10s default). */
export const DEFAULT_CHANNEL_HEARTBEAT_INTERVAL_MS = 10000 as const;
/** POLICY: channel shutdown grace period (60s default). */
export const DEFAULT_CHANNEL_GRACE_PERIOD_MS = 60000 as const;
/** MECHANISM: maximum channel shutdown grace period. */
export const MAX_CHANNEL_GRACE_PERIOD_MS = 600000 as const;
/** POLICY: consecutive heartbeat misses before TERMINATED. */
export const DEFAULT_HEARTBEAT_MISS_THRESHOLD = 3 as const;

// ─── Plan38 W2: Circuit Breaker / Bulkhead / Timeout ───

/** POLICY: failures before circuit opens. */
export const DEFAULT_CB_FAILURE_THRESHOLD = 3 as const;
/** POLICY: OPEN → HALF_OPEN cooldown (ms). */
export const DEFAULT_CB_COOLDOWN_MS = 30000 as const;
/** POLICY: sliding window for failure counting (ms). */
export const DEFAULT_CB_MONITOR_WINDOW_MS = 60000 as const;
/** POLICY: per-target max concurrent connections. */
export const DEFAULT_BULKHEAD_MAX_CONCURRENT = 5 as const;
/** POLICY: per-target overflow queue depth. */
export const DEFAULT_BULKHEAD_MAX_QUEUE = 10 as const;
/** POLICY: default message send timeout (ms). */
export const DEFAULT_MESSAGE_TIMEOUT_MS = 30000 as const;

// ─── Plan38 W3: Metadata limit ───

/** MECHANISM: max metadata entries per CommMessage. */
export const MAX_COMM_METADATA_ENTRIES = 32 as const;
/** MECHANISM: max size per metadata value in bytes. */
export const MAX_COMM_METADATA_VALUE_SIZE = 1024 as const;

// ─── Plan38 W5: Rate limiting ───

/** POLICY: per-agent message rate limit (msg/sec). */
export const DEFAULT_RATE_LIMIT_PER_AGENT = 100 as const;
/** POLICY: per-target message rate limit (msg/sec). */
export const DEFAULT_RATE_LIMIT_PER_TARGET = 20 as const;
/** POLICY: rate limit sliding window duration (ms). */
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 1000 as const;
