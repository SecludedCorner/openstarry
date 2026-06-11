/**
 * WIENER L2 + L3 Safety Framework — Threshold Constants (Plan49 C49-M5a).
 *
 * ─── HYPOTHESIS STATUS (Plan49 C49-M5g, MUST-unconditional) ───
 *
 * σ in the current deployment is a composition index over a deterministic
 * event-count vector (cycle 03-13 §四 finding); it is NOT a variance
 * estimator over a stochastic signal. Plan44/45 L2+L3 thresholds inherit
 * HYPOTHESIS status until BOTH:
 *   (a) Rule #72 N≥10 is met (per Rule #72 §72.1 — minimum observation gate), AND
 *   (b) Plan50 σ_regime annotation is live + telemetry-validated.
 *
 * FR-2-pooled-mode activation rationale (formerly cited in prior spec drafts)
 * has been WITHDRAWN. Re-calibration trigger is Rule #72 N≥10, cited directly.
 *
 * Current N progress: N=4/10 (cycles 03-09 .. 03-13 data points; projected
 * N≥10 around cycle 03-19 / R20). Until N gate opens, threshold VALUES in
 * this file are frozen per C49-M5e.
 *
 * Plan50 σ_regime forward-reference:
 *   σ_regime ∈ {deterministic_composition_index, stochastic_variance_estimator, mixed}
 * — Plan50 delivers the annotation; Plan49 consumes as read-only metadata.
 *
 * ─── MR-6 posture (C49-M5f) ───
 *
 * This module lives under `apps/runner/`, NOT `packages/core/`. No Core import
 * edge introduced; no Core policy constant added. Verified by:
 *   grep -rn "wiener/thresholds" packages/core/   → zero matches.
 *
 * ─── Scope (C49-M5e binding) ───
 *
 * This file is **preparation only**. Dev MUST NOT tune threshold VALUES in
 * Plan49. Any value change is Plan51+ scope contingent on Rule #72 N≥10 +
 * Plan50 σ_regime live.
 *
 * @see docs/EN+TW/wiener-thresholds.md  (HYPOTHESIS + re-calibration schedule)
 * @see share/research_team_suggestion/cycle03-13/deliver/O2_plan49_engineering_spec.md §2.5
 * @see openstarry_plugin/spc-monitor/src/escalation-monitor.ts  (L3 escalation consumer)
 */

/**
 * L2 threshold — WIENER control-loop calibration gate.
 *
 * Triggered when calibration residual exceeds this bound; gates Phase-3 shadow
 * decision emission. HYPOTHESIS value inherited from Plan44/45 baseline.
 */
export const L2_THRESHOLD = 0.85;

/**
 * L3 threshold — WIENER safety-gate escalation bound.
 *
 * Triggered when sustained residual exceeds this bound; emits
 * `safety:force_conservative_gear` via spc-monitor escalation-monitor.
 * HYPOTHESIS value inherited from Plan44/45 baseline.
 */
export const L3_THRESHOLD = 0.95;

/**
 * Rule #72 minimum observation count for threshold re-calibration gate.
 *
 * Threshold VALUE re-tuning is blocked until N ≥ MIN_N_FOR_RECAL.
 */
export const MIN_N_FOR_RECAL = 10;

/**
 * Telemetry event emitted when a threshold is touched at runtime (C49-M5b SHOULD).
 *
 * Consumed by Plan48 structured-log + audit-sink infrastructure. Supports R20+
 * SPC data collection for the Plan51+ re-calibration decision.
 */
export const WIENER_THRESHOLD_HIT_EVENT = "wiener_threshold_hit" as const;

export interface WienerThresholdHit {
  readonly threshold: "L2" | "L3";
  readonly value: number;
  readonly observed: number;
  readonly nAtHit: number;
  readonly timestamp: number;
}
