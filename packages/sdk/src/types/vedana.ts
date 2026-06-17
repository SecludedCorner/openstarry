/**
 * Vedana (受蘊) measurement types.
 *
 * Vedana is a continuous hedonic signal, NOT a three-case enum.
 * Discrete labels (dukkha/sukha/upekkha) are derived from continuous
 * valence via configurable thresholds.
 *
 * @skandha vedana (受蘊)
 * @see R3 Debate 5: Vedana Measurement Model (Doc 36)
 * @module vedana
 */

import type { IVedana } from "./aggregates.js";

/** Vedana type — three feelings (三受) */
export type VedanaType = 'dukkha' | 'sukha' | 'upekkha';

/**
 * ChannelVedana — continuous hedonic signal from a single sensory channel.
 *
 * Valence is continuous for PID control; discrete type is derived
 * via VedanaClassificationConfig thresholds.
 */
export interface ChannelVedana {
  /** Hedonic tone: [-1.0 (pain), +1.0 (pleasure)] */
  readonly valence: number;
  /** Arousal/strength: [0.0 (barely perceptible), 1.0 (overwhelming)] */
  readonly intensity: number;
  /** Derived discrete type via threshold classification */
  readonly type: VedanaType;
  /** Root gate identifier (e.g., "tool:error", "safety:warning") */
  readonly source: string;
}

/**
 * VedanaClassificationConfig — thresholds for deriving discrete type from valence.
 * Admin-lockable to prevent DoS (security: prevents threshold manipulation).
 */
export interface VedanaClassificationConfig {
  /** Threshold below which valence is classified as dukkha (default: -0.1) */
  readonly dukkhaThreshold: number;
  /** Threshold above which valence is classified as sukha (default: +0.1) */
  readonly sukhaThreshold: number;
}

/**
 * VedanaAssessment — complete PID evaluation result.
 * Aggregates multiple channel signals into a single assessment.
 */
export interface VedanaAssessment {
  /** Aggregate signal (weighted combination of all channels) */
  readonly aggregate: ChannelVedana;
  /** Individual channel signals */
  readonly channels: readonly ChannelVedana[];
  /** PID controller output (used for gain scheduling) */
  readonly pidOutput: number;
  /** Assessment timestamp */
  readonly timestamp: number;
}

/**
 * VedanaTag — O(1) cached label for fast access.
 * Avoids recomputing classification on every read.
 */
export interface VedanaTag {
  /** Cached discrete type */
  readonly type: VedanaType;
  /** Whether the cached value may be stale (needs recomputation) */
  readonly stale: boolean;
}

/**
 * IVedanaSensor — sensory channel that produces vedana signals.
 * Plugins can register sensors to provide vedana feedback from various sources.
 */
export interface IVedanaSensor extends IVedana {
  /** Unique sensor identifier */
  readonly id: string;
  /** Channel name (e.g., "tool-outcome", "safety-check", "user-feedback") */
  readonly channel: string;
  /** Produce a vedana signal from an incoming event */
  sense(event: unknown): ChannelVedana;
}

/**
 * VedanaDimension — multi-dimensional vedana representation (Plan27).
 * Extends scalar valence with arousal and dominance dimensions.
 */
export interface VedanaDimension {
  /** Hedonic tone: [-1.0 (pain), +1.0 (pleasure)] */
  readonly valence: number;
  /** Arousal/activation: [0.0 (calm), 1.0 (excited)] */
  readonly arousal: number;
  /** Dominance/control: [0.0 (submissive), 1.0 (dominant)] */
  readonly dominance: number;
}

/**
 * Convert a ChannelVedana to a VedanaDimension.
 * Maps intensity to arousal; dominance defaults to 0.5 (neutral).
 */
export function toVedanaDimension(vedana: ChannelVedana): VedanaDimension {
  return {
    valence: vedana.valence,
    arousal: vedana.intensity,
    dominance: 0.5,
  };
}

/**
 * Hard safety bounds for VedanaClassificationConfig (Doc 36 §13).
 * FIXED design constants (not calibrated): they cap how far the thresholds can
 * be pushed so a config cannot manufacture a "permanent upekkha" state that
 * silences the internal pain/pleasure feedback (an internal-feedback DoS).
 * dukkha must stay reachable (≥ -0.5) and sukha must stay reachable (≤ +0.5).
 * (Doc 36 §13 also names "upekkha bandwidth ≤ 1.0"; that is implied by these two
 * — max band = 0.5 − (−0.5) = 1.0 — so it needs no separate check.)
 */
export const VEDANA_MIN_DUKKHA_THRESHOLD = -0.5;
export const VEDANA_MAX_SUKHA_THRESHOLD = 0.5;

/**
 * Validate VedanaClassificationConfig.
 * Throws if dukkhaThreshold >= sukhaThreshold, or if either Doc 36 §13 hard
 * safety bound is violated (prevents threshold manipulation / DoS).
 */
export function validateVedanaConfig(config: VedanaClassificationConfig): void {
  if (config.dukkhaThreshold >= config.sukhaThreshold) {
    throw new Error(
      `Invalid VedanaClassificationConfig: dukkhaThreshold (${config.dukkhaThreshold}) ` +
      `must be less than sukhaThreshold (${config.sukhaThreshold})`
    );
  }
  // Doc 36 §13 hard bounds — keep dukkha/sukha reachable (anti-DoS).
  if (config.dukkhaThreshold < VEDANA_MIN_DUKKHA_THRESHOLD) {
    throw new Error(
      `Invalid VedanaClassificationConfig: dukkhaThreshold (${config.dukkhaThreshold}) ` +
      `must be >= ${VEDANA_MIN_DUKKHA_THRESHOLD} (Doc 36 §13: dukkha must stay reachable)`
    );
  }
  if (config.sukhaThreshold > VEDANA_MAX_SUKHA_THRESHOLD) {
    throw new Error(
      `Invalid VedanaClassificationConfig: sukhaThreshold (${config.sukhaThreshold}) ` +
      `must be <= ${VEDANA_MAX_SUKHA_THRESHOLD} (Doc 36 §13: sukha must stay reachable)`
    );
  }
}

/**
 * Classify valence into discrete VedanaType using thresholds.
 */
export function classifyVedana(valence: number, config: VedanaClassificationConfig): VedanaType {
  validateVedanaConfig(config);
  if (valence <= config.dukkhaThreshold) return 'dukkha';
  if (valence >= config.sukhaThreshold) return 'sukha';
  return 'upekkha';
}

/**
 * Default vedana classification config.
 */
export const DEFAULT_VEDANA_CONFIG: VedanaClassificationConfig = {
  dukkhaThreshold: -0.1,
  sukhaThreshold: 0.1,
};

/**
 * VedanaEmergencyConfig — configuration for VedanaEmergency mechanism.
 * Controls when sustained dukkha triggers threshold boosting in ManoAggregator.
 *
 * @see Plan28: VedanaEmergency wiring to ManoAggregator
 */
export interface VedanaEmergencyConfig {
  /** Intensity threshold to consider dukkha "sustained" (default: 0.8) */
  readonly intensityThreshold: number;
  /** Number of consecutive ticks dukkha must be sustained to trigger boost (default: 5) */
  readonly sustainedTicks: number;
  /** Maximum threshold boost when emergency is active (default: 0.15) */
  readonly maxThresholdBoost: number;
  /** Cooldown ticks after emergency before boost can re-trigger (default: 10) */
  readonly cooldownTicks: number;
}

/**
 * Default VedanaEmergency configuration.
 */
export const DEFAULT_VEDANA_EMERGENCY_CONFIG: VedanaEmergencyConfig = {
  intensityThreshold: 0.8,
  sustainedTicks: 5,
  maxThresholdBoost: 0.15,
  cooldownTicks: 10,
};

/**
 * VedanaSensorConfig — configurable gain for samskara vedana mapping.
 */
export interface VedanaSensorConfig {
  /** Maximum gain applied when mapping samskara outcomes to vedana (default: 0.3) */
  readonly maxSamskaraVedanaGain: number;
}

/**
 * Default vedana sensor config.
 */
export const DEFAULT_VEDANA_SENSOR_CONFIG: VedanaSensorConfig = {
  maxSamskaraVedanaGain: 0.3,
};
