/**
 * structured-log/safe-stringify — C48-M1b schema emission support.
 *
 * Safe JSON serialiser for structured-log payloads. Handles cases that would
 * otherwise crash or corrupt audit output (per Plan48 §5 R2 C-5R1-08 +
 * MRB-12 §12.2 JSON edge cases):
 *
 *   - Circular references → replaced with "[Circular ~]" sentinel (never throw).
 *   - BigInt values        → coerced to string primitive (JSON can't hold BigInt).
 *   - Error instances      → serialised with name / message / stack.
 *   - Very long strings    → truncated at {@link MAX_STRING_LEN} with tail sentinel.
 *
 * Layer: Runner.
 *
 * @since Plan48 C48-M1b
 */

/** Strings longer than this are truncated with a "...[truncated N]" suffix. */
export const MAX_STRING_LEN = 16 * 1024;

/** Sentinel inserted when a string is truncated. */
export const TRUNCATION_SENTINEL = '...[truncated]';

/** Sentinel inserted when a circular reference is detected. */
export const CIRCULAR_SENTINEL = '[Circular ~]';

export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const replacer = (_key: string, v: unknown): unknown => {
    if (typeof v === 'bigint') return `${v.toString()}n`;
    if (v instanceof Error) {
      return { name: v.name, message: v.message, stack: v.stack };
    }
    if (typeof v === 'string' && v.length > MAX_STRING_LEN) {
      return `${v.slice(0, MAX_STRING_LEN)}${TRUNCATION_SENTINEL}`;
    }
    if (v && typeof v === 'object') {
      if (seen.has(v as object)) return CIRCULAR_SENTINEL;
      seen.add(v as object);
    }
    return v;
  };
  try {
    return JSON.stringify(value, replacer);
  } catch {
    // Last-resort: value contains something stringify still rejects
    // (e.g., Symbol keys interacting with a custom toJSON). Emit a
    // diagnostic rather than throw — the caller is an audit path.
    return JSON.stringify({ __serialization_error: String(value) });
  }
}
