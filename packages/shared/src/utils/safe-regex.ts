/**
 * Safe regex utilities — SEC-029 ReDoS mitigation.
 *
 * Node.js single-threaded: cannot truly interrupt a running regex.
 * Uses static analysis (nested quantifier detection) + input length limiting.
 *
 * @see Plan29: SEC-029 ReDoS Mitigation
 * @module safe-regex
 */

/** Default maximum input length for safe regex testing. */
export const DEFAULT_MAX_INPUT_LEN = 1024;

/**
 * Detect ReDoS-vulnerable patterns via multiple heuristics.
 *
 * Checks:
 * 1. Nested quantifiers: (a+)+, (a*)+, (a{2,})+ etc.
 * 2. Alternation with overlap inside quantified group: (a|aa)+, (a|a?)+
 * 3. Deeply nested groups with quantifiers: ((a)+)+
 *
 * SEC-029-01 fix: covers alternation bypass, nested group bypass,
 * non-capturing group bypass, and unicode quantifier bypass.
 */
export function validateRegexSafety(pattern: string): boolean {
  // Strip character classes [...] to avoid false positives on quantifiers inside them
  const stripped = pattern.replace(/\[(?:[^\]\\]|\\.)*\]/g, '');

  // 1. Nested quantifiers: group with quantifier inside, followed by quantifier outside
  //    Handles capturing, non-capturing, and named groups
  if (/\([^)]*[+*}][^)]*\)[+*?{]/.test(stripped)) return false;

  // 2. Alternation inside a quantified group: (a|b)+ where branches can overlap
  if (/\([^)]*\|[^)]*\)[+*?{]/.test(stripped)) return false;

  // 3. Nested groups with quantifiers at any depth: ((a)+)+
  //    Count nested group depth with quantifiers
  let depth = 0;
  let quantifiedDepth = 0;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '\\') { i++; continue; }  // skip escaped chars
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      // Check if this closing paren is followed by a quantifier
      const next = stripped[i + 1];
      if (next === '+' || next === '*' || next === '{' || next === '?') {
        quantifiedDepth++;
        if (quantifiedDepth >= 2) return false;  // nested quantified groups
      }
      depth--;
      if (depth <= 0) { quantifiedDepth = 0; depth = 0; }
    }
  }

  return true;
}

/**
 * Safely test a regex against input with length limits and complexity checks.
 *
 * @param pattern - RegExp to test
 * @param input - Input string to test against
 * @param maxInputLen - Maximum allowed input length (default: 1024)
 * @returns Match result, or false if input too long or pattern unsafe
 */
export function safeRegexTest(
  pattern: RegExp,
  input: string,
  maxInputLen: number = DEFAULT_MAX_INPUT_LEN,
): boolean {
  if (input.length > maxInputLen) return false;
  if (!validateRegexSafety(pattern.source)) return false;
  return pattern.test(input);
}
