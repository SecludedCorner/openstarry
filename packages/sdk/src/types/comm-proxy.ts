/**
 * Communication proxy types — fault isolation configuration.
 * Plan38 C10 (D4-R4).
 */

import type { ICommChannel } from "./comm-channel.js";

/** Circuit breaker state machine states. */
export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/** L2 Circuit Breaker configuration (per-target). */
export interface CircuitBreakerConfig {
  /** Failures within window before circuit opens. POLICY. */
  failureThreshold: number;
  /** OPEN → HALF_OPEN cooldown in ms. POLICY. */
  cooldownMs: number;
  /** Failure counting window in ms. POLICY. */
  monitorWindowMs: number;
}

/** L3 Bulkhead configuration (per-target). */
export interface BulkheadConfig {
  /** Maximum concurrent connections per target. POLICY. */
  maxConcurrent: number;
  /** Overflow queue depth. POLICY. */
  maxQueue: number;
  /** Queue timeout in ms. POLICY. */
  queueTimeoutMs?: number;
}

/** L5 Timeout hierarchy configuration. */
export interface TimeoutHierarchyConfig {
  /** Outer timeout wrapping entire operation in ms. POLICY. */
  outerTimeoutMs: number;
}

/** Combined comm-proxy configuration. */
export interface CommProxyConfig {
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  bulkhead?: Partial<BulkheadConfig>;
  timeout?: Partial<TimeoutHierarchyConfig>;
}

/**
 * BulkheadType — discriminates fire-and-forget vs RPC bulkheads.
 * Split bulkhead design (D3-R3): failures in one lane do not bleed
 * into the other (CONSTRAINT-D14).
 *
 * FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * @since v0.39.0-alpha
 */
export type BulkheadType = 'fire-and-forget' | 'rpc';

/**
 * CommMethodResult<T> — normalized result from any comm method.
 * Error normalization is a core responsibility of CommProxyMethod.
 *
 * FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * @since v0.39.0-alpha
 */
export type CommMethodResult<T> =
  | { success: true; value: T }
  | { success: false; error: CommProxyError };

/**
 * CommProxyError — normalized error type from comm proxy methods.
 * All raw channel errors are mapped to this type before surfacing.
 *
 * FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * @since v0.39.0-alpha
 */
export interface CommProxyError {
  readonly code: 'TIMEOUT' | 'BULKHEAD_FULL' | 'CIRCUIT_OPEN' | 'CHANNEL_ERROR' | 'UNKNOWN';
  readonly message: string;
  readonly originalError?: unknown;
}

/**
 * ICommProxyMethod<TArgs, TResult> — Template Method interface for a single
 * comm proxy operation (reply, publish, call, send).
 *
 * The Template Method pattern (D3-R3) provides:
 * - preExecute(): validation, tracing setup (hook, optional override)
 * - execute(): the actual channel operation (abstract, must implement)
 * - postExecute(): cleanup, metrics emission (hook, optional override)
 * - onError(): error normalization (hook, optional override)
 *
 * Concrete implementations: SendMethod, ReplyMethod, PublishMethod, CallMethod.
 * Each selects its bulkhead type in the constructor.
 *
 * FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * @since v0.39.0-alpha
 */
export interface ICommProxyMethod<TArgs, TResult> {
  /** Which bulkhead lane this method uses. Determines concurrency limits. */
  readonly bulkheadType: BulkheadType;
  /**
   * Execute the full template: preExecute → execute → postExecute (or onError).
   * The proxy calls this method; never calls execute() directly.
   */
  run(args: TArgs): Promise<CommMethodResult<TResult>>;
}

/**
 * ICommProxy — fault-isolation decorator for ICommChannel.
 *
 * Wraps an existing ICommChannel with L2 (Circuit Breaker),
 * L3 (Bulkhead), and L5 (Timeout Hierarchy) protection layers.
 * Core sees only ICommChannel — proxy is transparent.
 *
 * Mandatory for multi-agent agents (Rule #38).
 * Factory: createCommProxyPlugin() -> IPlugin.
 *
 * FROZEN: Architecture_Spec Plan38, Cycle 20260328_cycle03-2.
 * @since v0.38.0-alpha
 */
export interface ICommProxy extends ICommChannel {
  /**
   * The underlying channel being wrapped.
   * Exposed for diagnostic purposes only — never call directly.
   */
  readonly inner: ICommChannel;

  /**
   * Per-target circuit breaker state snapshot.
   * Returns current state for the given target agent ID.
   */
  getCircuitBreakerState(targetAgentId: string): CircuitBreakerState;

  /**
   * Per-target bulkhead utilization.
   * Returns { concurrent, queued } for the given target.
   */
  getBulkheadUtilization(targetAgentId: string): { concurrent: number; queued: number };
}
