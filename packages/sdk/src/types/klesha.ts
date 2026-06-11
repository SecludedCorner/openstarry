/**
 * Klesha (煩惱) framework types.
 *
 * Four root kleshas modulate the VasanaEngine confidence threshold
 * via gain scheduling. Klesha belongs to vijnana (識蘊) per DC-12.
 *
 * @skandha vijnana (識蘊)
 * @see R3 Debate 3: Ego Framework + Klesha Gain Scheduling (Doc 37)
 * @module klesha
 */

import type { ChannelVedana } from "./vedana.js";

/** Four root klesha types */
export type KleshaType = 'moha' | 'drishti' | 'mana' | 'sneha';

/**
 * KleshaSignal — output from a single klesha's perceive() call.
 */
export interface KleshaSignal {
  /** Which klesha produced this signal */
  readonly type: KleshaType;
  /** Signal strength: [0.0, 1.0] */
  readonly value: number;
}

/**
 * KleshaSignalBundle — all four klesha signals bundled together.
 * Used as input to IVolition deliberation.
 */
export interface KleshaSignalBundle {
  readonly moha: number;    // ignorance (low-pass filter)
  readonly drishti: number; // self-view (band-pass filter)
  readonly mana: number;    // pride (PD controller)
  readonly sneha: number;   // attachment (integrator)
}

/**
 * KleshaDistribution — Beta distribution model for Bayesian tracking.
 * Each klesha maintains a posterior distribution over its activation level.
 */
export interface KleshaDistribution {
  /** Pseudo-count successes */
  readonly alpha: number;
  /** Pseudo-count failures */
  readonly beta: number;
  /** E[θ] = α/(α+β) — fast path (~0.001ms) */
  readonly mean: number;
  /** Compute credible interval at given level (slow path, for LLM context) */
  credibleInterval(level: number): [number, number];
}

/**
 * KleshaContext — context provided to IKlesha.perceive().
 */
export interface KleshaContext {
  /** Current session identifier */
  readonly sessionId?: string;
  /** Recent vedana signals for temporal context */
  readonly recentVedana: readonly ChannelVedana[];
  /** Recent action history (tool names) for behavioral context */
  readonly actionHistory: readonly string[];
}

/**
 * IKlesha — abstract klesha perceiver interface.
 * Each implementation uses a different signal-processing model:
 * - Moha: Low-pass filter (ignorance — smooths rapid changes)
 * - Drishti: Band-pass filter (self-view — amplifies certain frequency ranges)
 * - Mana: PD controller (pride — responds to value and rate of change)
 * - Sneha: Integrator (attachment — accumulates over time)
 */
export interface IKlesha {
  /** Klesha type identifier */
  readonly type: KleshaType;
  /** Perceive klesha signal from context (~0.006-0.016ms in vijnana-clock) */
  perceive(context: KleshaContext): KleshaSignal;
}

/**
 * KleshaModulationConfig — gain-scheduled threshold modulation.
 *
 * θ(t) = clamp(θ₀ + Σwᵢμᵢ(t), θ_min, θ_max)
 *
 * FC-27 ExtensionPoint: weights designed to be extensible.
 * v1 only uses sneha (−) and mana (+).
 */
export interface KleshaModulationConfig {
  /** Base confidence threshold (default: 0.6) */
  readonly baseThreshold: number;
  /** Floor — prevents perpetual low-gear operation (default: 0.3) */
  readonly minThreshold: number;
  /** Ceiling — prevents perpetual high-gear operation (default: 0.9) */
  readonly maxThreshold: number;
  /** Modulation weights per klesha */
  readonly weights: {
    /** Sneha (attachment) → negative weight (lowers threshold) */
    readonly sneha: number;
    /** Mana (pride) → positive weight (raises threshold) */
    readonly mana: number;
  };
}

/**
 * VitakkaWatchdogConfig — prevents samsaric stall (N-Gear generalized).
 * When any non-default gear runs too long without switching back,
 * the watchdog forces a switch to the default gear.
 *
 * Per-gear limits: keys are gear numbers, values are limits.
 * Gears not listed have no watchdog limit.
 */
export interface VitakkaWatchdogConfig {
  /** Per-gear max duration in ms before forced switch (e.g., { 1: 5000 }) */
  readonly maxGearDurationMs: Record<number, number>;
  /** Per-gear max consecutive cycles before forced switch (e.g., { 1: 10 }) */
  readonly maxConsecutiveGearCycles: Record<number, number>;
}

/**
 * MohaConfig — configuration for Moha action-based update.
 * Controls diminishing marginal returns of repetition-driven moha increase.
 *
 * @see Plan28: Moha.updateFromAction()
 */
export interface MohaConfig {
  /** Additive gain coefficient (default: 0.02) */
  readonly alphaM: number;
  /** Saturation denominator coefficient (default: 5.0) */
  readonly betaM: number;
}

/**
 * Default Moha config.
 */
export const DEFAULT_MOHA_CONFIG: MohaConfig = {
  alphaM: 0.02,
  betaM: 5.0,
};

/**
 * Default klesha modulation config.
 */
export const DEFAULT_KLESHA_MODULATION_CONFIG: KleshaModulationConfig = {
  baseThreshold: 0.6,
  minThreshold: 0.3,
  maxThreshold: 0.9,
  weights: {
    sneha: -0.15,
    mana: 0.15,
  },
};

/**
 * Default vitakka watchdog config.
 */
export const DEFAULT_VITAKKA_WATCHDOG_CONFIG: VitakkaWatchdogConfig = {
  maxGearDurationMs: { 1: 5000 },
  maxConsecutiveGearCycles: { 1: 10 },
};

// ── Plan32 Wave 4 (P1): Klesha filter configurations ──────────────

/**
 * MohaFilterConfig — low-pass filter parameters for Moha.
 */
export interface MohaFilterConfig {
  /** Smoothing factor alpha for EMA (default: 0.3) */
  readonly smoothingFactor: number;
  /** Variance scaling factor for rawMoha computation (default: 5) */
  readonly varianceScale: number;
}

/**
 * DrishtiFilterConfig — band-pass filter parameters for Drishti.
 */
export interface DrishtiFilterConfig {
  /** Number of recent actions to consider (default: 5) */
  readonly lookbackSize: number;
  /** Proportional weight in band-pass output (default: 0.7) */
  readonly proportionalWeight: number;
  /** Derivative weight in band-pass output (default: 0.3) */
  readonly derivativeWeight: number;
}

/**
 * ManaFilterConfig — PD controller parameters for Mana.
 */
export interface ManaFilterConfig {
  /** Proportional gain (default: 0.6) */
  readonly kp: number;
  /** Derivative gain (default: 0.4) */
  readonly kd: number;
}

/**
 * SnehaFilterConfig — integrator parameters for Sneha.
 */
export interface SnehaFilterConfig {
  /** Integration gain per step (default: 0.10) */
  readonly gain: number;
  /** Minimum floor value (default: 0.10) */
  readonly floor: number;
  /** Maximum level cap (default: 0.95) */
  readonly maxLevel: number;
  /** Exponential decay lambda (default: 0.05) */
  readonly lambda: number;
}

/**
 * KleshaFilterConfig — combined filter configuration for all four kleshas.
 * Plan32 Wave 4 (P1): extracted from core/vijnana/klesha.ts hardcoded defaults.
 */
export interface KleshaFilterConfig {
  readonly moha: MohaFilterConfig;
  readonly drishti: DrishtiFilterConfig;
  readonly mana: ManaFilterConfig;
  readonly sneha: SnehaFilterConfig;
}

/**
 * Default klesha filter configuration.
 * Canonical source of truth per SUSSMAN three-layer model.
 */
export const DEFAULT_KLESHA_FILTER_CONFIG: KleshaFilterConfig = {
  moha: { smoothingFactor: 0.3, varianceScale: 5 },
  drishti: { lookbackSize: 5, proportionalWeight: 0.7, derivativeWeight: 0.3 },
  mana: { kp: 0.6, kd: 0.4 },
  sneha: { gain: 0.10, floor: 0.10, maxLevel: 0.95, lambda: 0.05 },
};
