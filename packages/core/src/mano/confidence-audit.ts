/**
 * Confidence audit utilities.
 *
 * @see Plan29: IConfidenceAuditor + Model Delta Layer 2
 * @see Plan32 Wave 3: maxDelta externalized to config
 * @module confidence-audit
 */

/** Clamp a raw audit delta to ±maxDelta. NaN/Infinity → 0. */
export function clampAuditDelta(rawDelta: number, maxDelta: number): number {
  // NaN/Infinity → 0 (IEEE 754 necessity, mechanism value)
  if (!Number.isFinite(rawDelta)) return 0;
  return Math.max(-maxDelta, Math.min(maxDelta, rawDelta));
}
