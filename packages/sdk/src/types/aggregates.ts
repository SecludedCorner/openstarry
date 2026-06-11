/**
 * Five Aggregates (五蘊) Root Interfaces.
 *
 * These interfaces establish the philosophical-architectural foundation
 * of OpenStarry, mapping Buddhist Five Aggregates to software patterns.
 *
 * Plan25: Sanskrit renaming (M-1) — IRupa, IVedana, ISamjna, ISamskara, IVijnana.
 *
 * @module aggregates
 */

/**
 * IRupa — 色蘊 Root Interface.
 * @skandha rupa (色蘊)
 *
 * Rupa aggregate encompasses all form and materiality:
 * - IListener (感官根·輸入): Sensory input channels
 * - IUI (顯相·輸出): Output rendering
 *
 * Sanskrit: Rūpa (रूप) — form, materiality.
 */
export interface IRupa {
  /** @skandha rupa */
  readonly skandha: 'rupa';
}

/**
 * IVedana — 受蘊 Root Interface.
 * @skandha vedana (受蘊)
 *
 * Vedana aggregate encompasses the three feelings (三受):
 * - Dukkha (苦): Pain/negative feedback
 * - Sukha (樂): Pleasure/positive feedback
 * - Upekkha (捨): Equanimity/neutral feedback
 *
 * Sanskrit: Vedanā (वेदना) — feeling, sensation.
 * @see vedana.ts for ChannelVedana, VedanaAssessment, IVedanaSensor
 * @see klesha.ts for Klesha framework (DC-12: vijnana scope)
 * @see volition.ts for IVolition two-phase deliberation
 */
export interface IVedana {
  /** @skandha vedana */
  readonly skandha: 'vedana';
}

/**
 * ISamjna — 想蘊 Root Interface.
 * @skandha samjna (想蘊)
 *
 * Samjna aggregate encompasses recognition and perception:
 * - IProvider: LLM backends for cognitive processing
 *
 * Sanskrit: Samjñā (संज्ञा) — perception, cognition.
 * D-05: Provider covers the full cognitive processing spectrum.
 */
export interface ISamjna {
  /** @skandha samjna */
  readonly skandha: 'samjna';
}

/**
 * ISamskara — 行蘊 Root Interface.
 * @skandha samskara (行蘊)
 *
 * Samskara aggregate encompasses volitional formations:
 * - ITool: Executable actions and tool calling
 *
 * Sanskrit: Samskāra (संस्कार) — formation, volition.
 */
export interface ISamskara {
  /** @skandha samskara */
  readonly skandha: 'samskara';
}

/**
 * IVijnana — 識蘊 Root Interface.
 * @skandha vijnana (識蘊)
 *
 * Vijnana aggregate encompasses consciousness and ego framework:
 * - IGuide: Behavioral constraints and self-convergence (我執框架)
 *
 * Sanskrit: Vijñāna (विज्ञान) — consciousness.
 * Note: Guide is a behavioral constraint mechanism, not "soul".
 */
export interface IVijnana {
  /** @skandha vijnana */
  readonly skandha: 'vijnana';
}

/**
 * Skandha type — discriminated union for Five Aggregates.
 */
export type Skandha = 'rupa' | 'vedana' | 'samjna' | 'samskara' | 'vijnana';

/**
 * Type guard: check if an object belongs to a specific aggregate.
 */
export function isSkandha<S extends Skandha>(
  obj: unknown,
  skandha: S,
): obj is { skandha: S } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'skandha' in obj &&
    (obj as { skandha: unknown }).skandha === skandha
  );
}

/**
 * Check if a plugin manifest declares a specific skandha.
 * Supports both single-value and multi-value skandha fields.
 *
 * Uses structural typing to avoid circular dependency with plugin.ts.
 */
export function hasSkandha(
  manifest: { skandha?: Skandha | readonly Skandha[] },
  skandha: Skandha,
): boolean {
  const s = manifest.skandha;
  if (s == null) return false;
  if (Array.isArray(s)) return s.includes(skandha);
  return s === skandha;
}
