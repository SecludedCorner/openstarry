/**
 * redaction — Canonical redaction helpers for plugin sourceContext + log emissions.
 *
 * **Cycle 03-19 γ retrofit BINDING** (per Master directive 2026-04-30 §4 +
 * Reference/15 Security Retroactive Precedent + cycle 03-19 R3 D-§4 23/0
 * UNANIMOUS): all plugins emitting user-content payloads MUST use this
 * canonical helper.
 *
 * **Plan56 cycle 03-18 D-§1-R2-B 22/1**: format `<redacted-volition-payload
 * len:NN first4:abcd>` — N=4 alphanumeric ceiling; category-aware sensitivity
 * applied at call site.
 *
 * **DSS-CY18-02 / DSS-CY19-§1-C** (KERNEL N=8 hex preference): preserved per
 * MR-11; N=4 alphanumeric ratified.
 *
 * @see openstarry_doc/Calibration_Reports/redaction_security_debt.md
 */

const FIRST4_MAX = 4;

/** Strip non-alphanumeric; keep first N alphanumerics. */
function alphanumericPrefix(payload: string, n: number): string {
  let out = '';
  for (const ch of payload) {
    if (out.length >= n) break;
    if (/[A-Za-z0-9]/.test(ch)) out += ch;
  }
  return out;
}

/**
 * Redact a payload to the codified format used by Plan56 multi-ivolition,
 * Plan57 vasana-engine, and γ-retrofitted plugins (cycle 03-19+).
 *
 * Per cycle 03-18 D-§1-R2-B 22/1 + cycle 03-19 D-§4-R2-B reaffirm.
 */
export function redactPayload(payload: string, kind: 'volition-payload' | 'vasana-deposit' | 'plugin-payload' = 'plugin-payload'): string {
  const len = payload.length;
  const first4 = alphanumericPrefix(payload, FIRST4_MAX);
  return `<redacted-${kind} len:${len} first4:${first4}>`;
}

/**
 * Predicate for forward-only enforcement in lint / audit tooling.
 * Returns true iff `s` matches the canonical redaction shape for any kind.
 */
export function isRedactedFormat(s: string): boolean {
  return /^<redacted-(volition-payload|vasana-deposit|plugin-payload) len:\d+ first4:[A-Za-z0-9]{0,4}>$/.test(s);
}
