/**
 * multi-ivolition / redaction — Plan56 §5.3 + Batch 15 Item #3.
 *
 * **R3 A4 22/1**: redaction format `<redacted-volition-payload len:NN first4:abcd>`.
 *
 *   - `len:NN` — original payload character length (decimal).
 *   - `first4:abcd` — first 4 chars of original payload, **alphanumeric only**
 *     (punctuation/whitespace stripped before extraction); N=4 maximum.
 *
 * **Forward-only at this implementation** (per Master directive 2026-04-30 γ):
 * existing plugin retrofit is cycle 03-19 scope. Plan56 itself MUST use this
 * codified format from emit-time logging.
 *
 * **DSS-CY18-02** (KERNEL, 1 vote; preferred N=8 hex): preserved per MR-11
 * UNCONDITIONAL. The N=4 alphanumeric ceiling holds.
 *
 * @see research record/cycle03-18/deliver/O1_D30_4_Plan56_implementation_final.md §5.3-§5.4
 */

const FIRST4_MAX = 4;

/** Strip punctuation/whitespace; keep alphanumeric only. */
function alphanumericPrefix(payload: string, n: number): string {
  let out = '';
  for (const ch of payload) {
    if (out.length >= n) break;
    if (/[A-Za-z0-9]/.test(ch)) out += ch;
  }
  return out;
}

/**
 * Redact a volition payload to the codified format.
 *
 * Per spec §5.4 "first-4 character exposure rule MUST be tightest for
 * HIGH-sensitivity categories" — this function applies the strictest form
 * (N=4 alphanumeric) uniformly. Categories carry sensitivity metadata in
 * the audit log but the redacted string is identical across categories.
 */
export function redactVolitionPayload(payload: string): string {
  const len = payload.length;
  const first4 = alphanumericPrefix(payload, FIRST4_MAX);
  return `<redacted-volition-payload len:${len} first4:${first4}>`;
}

/** Predicate for forward-only enforcement: detect the codified format. */
export function isRedactedFormat(s: string): boolean {
  return /^<redacted-volition-payload len:\d+ first4:[A-Za-z0-9]{0,4}>$/.test(s);
}
