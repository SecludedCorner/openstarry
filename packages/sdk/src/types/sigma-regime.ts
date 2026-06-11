/**
 * sigma-regime — Plan50 closed enum + observation interface.
 *
 * Per Plan50 BINDING (cycle 03-13 D-04 18/5 + cycle 03-14 R3 D-§2-Q1+Q2+Q4
 * UNANIMOUS + MRB-§2-01 RESOLVED). Lives in `packages/sdk/` per MR-6 (no
 * Core surface; spc-monitor + future emitters consume from SDK).
 *
 * @see openstarry_doc/Technical_Specifications/Plan50_Sigma_Regime_Binding.md
 */

/**
 * SigmaRegime — closed taxonomic enumeration over (determinism × homogeneity).
 *
 * - `composition_index`: σ from deterministic event-count vector × constant
 *   lookup; 3-round identity holds. Default for cycle 03-14 pipeline (CV-§1-08
 *   confirmed pushInput → composition_index).
 * - `llm_variance`: σ from at least one LLM-stochastic source; 3-round
 *   identity does NOT hold.
 * - `mixed`: BOTH static-lookup AND llm-variance sources within a single round;
 *   partial determinism.
 *
 * A 4th regime (e.g. `quantum_variance`) requires deliberate breaking-type
 * change per LINNAEUS R2 taxonomic-exhaustiveness analysis.
 */
export type SigmaRegime = 'composition_index' | 'llm_variance' | 'mixed';

/**
 * SigmaObservation — augmented σ record (Path-C 21-field per Plan50 §3.2).
 *
 * `sigma_regime` is REQUIRED on new records (no nullable type). Legacy
 * pre-Plan50 records are retroactively tagged `composition_index` via the
 * migration helper (Plan50 §6). Runtime assertion at serializer boundary
 * detects accidental tag drop (Plan50 §7).
 */
export interface SigmaObservation {
  readonly round_id: string;
  readonly sigma: number;
  readonly ucl: number;
  readonly lcl: number;
  readonly N_events: number;
  readonly mean: number;
  readonly pooled_mode: boolean;
  readonly westgard_state: string;
  /** Plan50 NEW field (Path-C field 21; required, no type-level default). */
  readonly sigma_regime: SigmaRegime;
}

/**
 * InputSource — declarative plugin self-attestation contract for σ_regime
 * inference (Plan50 §3.6 + §5 Hypothesis A).
 *
 * A plugin contributing values to σ computation MUST declare the source class
 * at manifest level. F-13 + F-14 runtime probes catch mis-declaration; H3
 * HMAC manifest signature is reserved as ENG-FAB v1.9 candidate F-18.
 */
export interface InputSource {
  /** Stable name of the contributing plugin or input lane. */
  readonly name: string;
  /** Attests static-lookup (deterministic constant table). */
  readonly is_static_lookup: boolean;
  /** Attests LLM-stochastic provenance (sampling, entropy, response-derived). */
  readonly is_llm_derived: boolean;
}
