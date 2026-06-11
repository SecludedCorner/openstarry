/**
 * ILoopQualityMonitor — loop quality monitoring types.
 *
 * Monitors observe the execution loop and report quality metrics.
 * Multiple monitors can be registered (array slot, no priority ordering).
 *
 * Model Delta Layer 3 (Delta_loopQuality) infrastructure.
 *
 * @skandha vijnana (識蘊)
 * @see Plan29: ILoopQualityMonitor + IConfidenceAuditor
 * @module loop-quality-monitor
 */

import type { EventBus } from "./events.js";

/**
 * LoopQualityVector — multi-dimensional quality signal.
 */
export interface LoopQualityVector {
  /** Coherence: [0.0, 1.0] — how logically consistent the loop behavior is */
  readonly coherence: number;
  /** Efficiency: [0.0, 1.0] — resource utilization efficiency */
  readonly efficiency: number;
  /** Convergence: [0.0, 1.0] — whether the loop is progressing toward a goal */
  readonly convergence: number;
  /** Stability: [0.0, 1.0] — absence of oscillation or thrashing */
  readonly stability: number;
}

/**
 * LoopQualityWeights — weights for combining LoopQualityVector dimensions.
 */
export interface LoopQualityWeights {
  readonly coherence: number;
  readonly efficiency: number;
  readonly convergence: number;
  readonly stability: number;
}

/**
 * Default weights: equal 0.25 × 4 (D5-R7).
 */
export const DEFAULT_LOOP_QUALITY_WEIGHTS: LoopQualityWeights = {
  coherence: 0.25,
  efficiency: 0.25,
  convergence: 0.25,
  stability: 0.25,
};

/**
 * LoopQualityReport — aggregated quality report from a monitor.
 */
export interface LoopQualityReport {
  /** Monitor ID that produced this report */
  readonly monitorId: string;
  /** Quality vector */
  readonly vector: LoopQualityVector;
  /** Weighted scalar score (computed using LoopQualityWeights) */
  readonly score: number;
  /** Report timestamp */
  readonly timestamp: number;
}

/**
 * ILoopQualityMonitor — a plugin-provided loop quality monitor.
 *
 * Monitors subscribe to EventBus events and track quality metrics.
 * start() is called when the execution loop begins; stop() on cleanup.
 */
export interface ILoopQualityMonitor {
  /** Unique monitor identifier */
  readonly id: string;
  /** Start monitoring (subscribe to bus events) */
  start(bus: EventBus): void;
  /** Stop monitoring (unsubscribe, release resources) */
  stop(): void;
  /** Get the latest quality report (returns null if no data yet) */
  getReport(): LoopQualityReport | null;
}

/**
 * MINIMAL_QUALITY_EVENTS — the six EventBus events DefaultLoopQualityMonitor subscribes to.
 * Exported for alternative monitor implementations and tests.
 *
 * @see Plan30 Wave 3, D3-R2
 */
export const MINIMAL_QUALITY_EVENTS = [
  'gear:arbiter_evaluated',
  'gear:switch',
  'action:proposed',
  'tool:result',
  'loop:started',
  'loop:finished',
] as const;

export type MinimalQualityEvent = (typeof MINIMAL_QUALITY_EVENTS)[number];
