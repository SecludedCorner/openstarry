/**
 * Plan56 §5.3-§5.4 + Batch 15 Item #3 — redaction format tests.
 *
 * R3 A4 22/1: format `<redacted-volition-payload len:NN first4:abcd>` +
 * N=4 alphanumeric ceiling + category-aware (HIGH-sensitivity strictest).
 */

import { describe, expect, it } from 'vitest';
import {
  redactVolitionPayload,
  isRedactedFormat,
} from '../../src/multi-ivolition/redaction.js';

describe('Plan56 §5.3 — redactVolitionPayload', () => {
  it('emits len + first4 in canonical format', () => {
    expect(redactVolitionPayload('hello world')).toBe('<redacted-volition-payload len:11 first4:hell>');
  });

  it('strips punctuation/whitespace before first-4 extraction (alphanumeric only)', () => {
    expect(redactVolitionPayload('!!!@#$ ab cd ef')).toBe('<redacted-volition-payload len:15 first4:abcd>');
    expect(redactVolitionPayload('  spaces only  ')).toBe('<redacted-volition-payload len:15 first4:spac>');
  });

  it('handles short payloads (<4 alphanumeric chars)', () => {
    expect(redactVolitionPayload('ab')).toBe('<redacted-volition-payload len:2 first4:ab>');
    expect(redactVolitionPayload('!@#')).toBe('<redacted-volition-payload len:3 first4:>');
  });

  it('handles empty payload', () => {
    expect(redactVolitionPayload('')).toBe('<redacted-volition-payload len:0 first4:>');
  });

  it('caps first4 at exactly 4 chars (DSS-CY18-02 N=4 ceiling preserved)', () => {
    const result = redactVolitionPayload('abcdefghijklmnop');
    expect(result).toBe('<redacted-volition-payload len:16 first4:abcd>');
    // Verify first4 is exactly 4
    const match = result.match(/first4:([A-Za-z0-9]*)/);
    expect(match?.[1]?.length).toBe(4);
  });

  it('handles multibyte content (counts JS chars, not bytes)', () => {
    // Multibyte chars excluded by alphanumeric filter; len is JS .length.
    const out = redactVolitionPayload('日本語abc');
    expect(out).toBe('<redacted-volition-payload len:6 first4:abc>');
  });

  it('preserves alphanumeric mix correctly', () => {
    expect(redactVolitionPayload('a1B2c3d4')).toBe('<redacted-volition-payload len:8 first4:a1B2>');
  });
});

describe('Plan56 §5.3 — isRedactedFormat predicate (forward-only enforcement)', () => {
  it('matches the codified format', () => {
    expect(isRedactedFormat('<redacted-volition-payload len:11 first4:hell>')).toBe(true);
    expect(isRedactedFormat('<redacted-volition-payload len:0 first4:>')).toBe(true);
  });

  it('rejects non-conforming strings', () => {
    expect(isRedactedFormat('plain text')).toBe(false);
    expect(isRedactedFormat('<redacted-volition-payload>')).toBe(false);
    // Wrong character class (non-alphanumeric in first4):
    expect(isRedactedFormat('<redacted-volition-payload len:5 first4:!@#$>')).toBe(false);
  });
});
