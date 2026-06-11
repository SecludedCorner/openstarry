/**
 * Klesha implementations — four root kleshas with signal-processing models.
 *
 * Each klesha uses a different filter/controller model:
 * - Moha (無明): Low-pass filter — smooths rapid changes (ignorance)
 * - Drishti (見): Band-pass filter — amplifies mid-frequency patterns (self-view)
 * - Mana (慢): PD controller — responds to value + rate of change (pride)
 * - Sneha (愛): Integrator — accumulates over time (attachment)
 *
 * @skandha vijnana (識蘊)
 * @see R3 Debate 3: Klesha Gain Scheduling (Doc 37)
 */

import type {
  IKlesha,
  KleshaSignal,
  KleshaContext,
  KleshaSignalBundle,
  KleshaModulationConfig,
  MohaConfig,
  MohaFilterConfig,
  DrishtiFilterConfig,
  ManaFilterConfig,
  SnehaFilterConfig,
  KleshaFilterConfig,
} from "@openstarry/sdk";
import { DEFAULT_MOHA_CONFIG, DEFAULT_KLESHA_FILTER_CONFIG } from "@openstarry/sdk";

/**
 * Moha — Low-pass filter (ignorance).
 * Smooths out rapid vedana fluctuations, representing inertia/ignorance.
 * High moha = system is slow to respond to changing conditions.
 */
export class Moha implements IKlesha {
  readonly type = 'moha' as const;
  private smoothedValue = 0;
  private readonly alpha: number;
  private readonly varianceScale: number;
  private readonly mohaConfig: MohaConfig;

  constructor(
    smoothingFactor = DEFAULT_KLESHA_FILTER_CONFIG.moha.smoothingFactor,
    mohaConfig: MohaConfig = DEFAULT_MOHA_CONFIG,
    varianceScale = DEFAULT_KLESHA_FILTER_CONFIG.moha.varianceScale,
  ) {
    this.alpha = Math.max(0, Math.min(1, smoothingFactor));
    this.varianceScale = varianceScale;
    this.mohaConfig = mohaConfig;
  }

  perceive(context: KleshaContext): KleshaSignal {
    const vedana = context.recentVedana;
    if (vedana.length === 0) {
      return { type: 'moha', value: this.smoothedValue };
    }

    // Low-pass: weighted average of recent absolute valence changes
    const avgAbsValence = vedana.reduce((sum, v) => sum + Math.abs(v.valence), 0) / vedana.length;
    // High variance in vedana → low moha (system is aware of changes)
    // Low variance → high moha (system ignores changes)
    const variance = vedana.length > 1
      ? vedana.reduce((sum, v) => sum + (Math.abs(v.valence) - avgAbsValence) ** 2, 0) / vedana.length
      : 0;

    const rawMoha = Math.max(0, 1 - variance * this.varianceScale);
    this.smoothedValue = this.alpha * rawMoha + (1 - this.alpha) * this.smoothedValue;

    return { type: 'moha', value: clamp01(this.smoothedValue) };
  }

  updateFromAction(currentMoha: number, repetitionRatio: number): number {
    const delta = this.mohaConfig.alphaM * repetitionRatio / (1 + this.mohaConfig.betaM * currentMoha);
    return Math.min(currentMoha + delta, 1.0);
  }
}

/**
 * Drishti — Band-pass filter (self-view).
 * Amplifies patterns that match the agent's self-concept.
 * High drishti = strong identification with certain action patterns.
 */
export class Drishti implements IKlesha {
  readonly type = 'drishti' as const;
  private previousValue = 0;
  private readonly lookbackSize: number;
  private readonly proportionalWeight: number;
  private readonly derivativeWeight: number;

  constructor(
    filterConfig: DrishtiFilterConfig = DEFAULT_KLESHA_FILTER_CONFIG.drishti,
  ) {
    this.lookbackSize = filterConfig.lookbackSize;
    this.proportionalWeight = filterConfig.proportionalWeight;
    this.derivativeWeight = filterConfig.derivativeWeight;
  }

  perceive(context: KleshaContext): KleshaSignal {
    const { actionHistory } = context;
    if (actionHistory.length < 2) {
      return { type: 'drishti', value: 0 };
    }

    // Band-pass: detect repetition in action patterns (self-reinforcing view)
    const recent = actionHistory.slice(-this.lookbackSize);
    const uniqueActions = new Set(recent).size;
    const repetitionRatio = 1 - (uniqueActions / recent.length);

    // Band-pass: combine current and derivative
    const derivative = repetitionRatio - this.previousValue;
    this.previousValue = repetitionRatio;

    // Amplify mid-range changes (band-pass behavior)
    const bandPass = repetitionRatio * this.proportionalWeight + Math.abs(derivative) * this.derivativeWeight;

    return { type: 'drishti', value: clamp01(bandPass) };
  }
}

/**
 * Mana — PD controller (pride).
 * Responds to both current success level and rate of change.
 * High mana = system overestimates its capabilities.
 */
export class Mana implements IKlesha {
  readonly type = 'mana' as const;
  private previousValence = 0;
  private readonly kp: number;
  private readonly kd: number;

  constructor(
    kp = DEFAULT_KLESHA_FILTER_CONFIG.mana.kp,
    kd = DEFAULT_KLESHA_FILTER_CONFIG.mana.kd,
  ) {
    this.kp = kp;
    this.kd = kd;
  }

  perceive(context: KleshaContext): KleshaSignal {
    const vedana = context.recentVedana;
    if (vedana.length === 0) {
      return { type: 'mana', value: 0 };
    }

    // Use positive valence as "success" signal
    const avgValence = vedana.reduce((sum, v) => sum + v.valence, 0) / vedana.length;
    const positiveValence = Math.max(0, avgValence); // Only positive contributes to pride

    // PD control: proportional + derivative
    const derivative = positiveValence - this.previousValence;
    this.previousValence = positiveValence;

    const pdOutput = this.kp * positiveValence + this.kd * Math.max(0, derivative);

    return { type: 'mana', value: clamp01(pdOutput) };
  }
}

/**
 * Sneha configuration options (Plan27).
 * Defaults sourced from SDK DEFAULT_KLESHA_FILTER_CONFIG.sneha.
 */
export interface SnehaConfig {
  /** Integration gain per step */
  gain?: number;
  /** Minimum floor value */
  floor?: number;
  /** Maximum level cap */
  maxLevel?: number;
  /** Exponential decay lambda */
  lambda?: number;
}

/**
 * Sneha — Integrator (attachment).
 * Accumulates attachment over time based on repeated positive outcomes.
 * High sneha = strong attachment to successful patterns.
 *
 * Plan27: Switched from positional args to options object.
 * Uses exponential decay instead of linear.
 */
export class Sneha implements IKlesha {
  readonly type = 'sneha' as const;
  private integral = 0;
  private readonly gain: number;
  private readonly floor: number;
  private readonly maxLevel: number;
  private readonly lambda: number;

  constructor(config: SnehaConfig = {}) {
    const defaults = DEFAULT_KLESHA_FILTER_CONFIG.sneha;
    this.gain = config.gain ?? defaults.gain;
    this.floor = config.floor ?? defaults.floor;
    this.maxLevel = config.maxLevel ?? defaults.maxLevel;
    this.lambda = config.lambda ?? defaults.lambda;
  }

  perceive(context: KleshaContext): KleshaSignal {
    const vedana = context.recentVedana;
    if (vedana.length === 0) {
      // Exponential decay when no input
      this.integral = this.integral * Math.exp(-this.lambda);
      // Enforce floor/maxLevel bounds
      this.integral = Math.max(this.floor, Math.min(this.maxLevel, this.integral));
      return { type: 'sneha', value: clamp01(this.integral) };
    }

    // Integrate positive valence (attachment to pleasant outcomes)
    const avgPositiveValence = vedana.reduce((sum, v) => sum + Math.max(0, v.valence), 0) / vedana.length;
    this.integral += this.gain * avgPositiveValence;

    // Apply exponential decay
    this.integral = this.integral * Math.exp(-this.lambda);

    // Enforce floor/maxLevel bounds
    this.integral = Math.max(this.floor, Math.min(this.maxLevel, this.integral));

    return { type: 'sneha', value: clamp01(this.integral) };
  }
}

/**
 * KleshaModulatedDispatcher — computes gain-scheduled threshold from klesha signals.
 *
 * θ(t) = clamp(θ₀ + Σwᵢμᵢ(t), θ_min, θ_max)
 *
 * FC-27 ExtensionPoint: weights designed to be extensible.
 * v1 only uses sneha (−) and mana (+).
 */
export class KleshaModulatedDispatcher {
  private readonly kleshas: IKlesha[];
  private readonly config: KleshaModulationConfig;

  constructor(kleshas: IKlesha[], config: KleshaModulationConfig) {
    this.kleshas = kleshas;
    this.config = config;
  }

  /**
   * Compute all klesha signals from context.
   */
  perceiveAll(context: KleshaContext): KleshaSignalBundle {
    const signals: Record<string, number> = {
      moha: 0,
      drishti: 0,
      mana: 0,
      sneha: 0,
    };

    for (const klesha of this.kleshas) {
      const signal = klesha.perceive(context);
      signals[signal.type] = signal.value;
    }

    return {
      moha: signals.moha,
      drishti: signals.drishti,
      mana: signals.mana,
      sneha: signals.sneha,
    };
  }

  /**
   * Compute the gain-scheduled threshold.
   * θ(t) = clamp(θ₀ + w_sneha·μ_sneha + w_mana·μ_mana, θ_min, θ_max)
   */
  computeThreshold(signals: KleshaSignalBundle): number {
    const { baseThreshold, minThreshold, maxThreshold, weights } = this.config;
    const modulation = weights.sneha * signals.sneha + weights.mana * signals.mana;
    return Math.max(minThreshold, Math.min(maxThreshold, baseThreshold + modulation));
  }
}

/**
 * Create default klesha set with parameters from KleshaFilterConfig.
 * Config defaults to SDK DEFAULT_KLESHA_FILTER_CONFIG.
 */
export function createDefaultKleshas(
  filterConfig: KleshaFilterConfig = DEFAULT_KLESHA_FILTER_CONFIG,
): IKlesha[] {
  return [
    new Moha(filterConfig.moha.smoothingFactor, DEFAULT_MOHA_CONFIG, filterConfig.moha.varianceScale),
    new Drishti(filterConfig.drishti),
    new Mana(filterConfig.mana.kp, filterConfig.mana.kd),
    new Sneha(filterConfig.sneha),
  ];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
