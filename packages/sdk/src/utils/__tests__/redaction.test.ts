/**
 * SDK redaction helper tests — γ retrofit canonical format.
 */

import { describe, expect, it } from 'vitest';
import { redactPayload, isRedactedPayload } from '@openstarry/sdk';

describe('cycle 03-19 γ retrofit — redactPayload', () => {
  it('default kind = plugin-payload', () => {
    expect(redactPayload('hello world')).toBe('<redacted-plugin-payload len:11 first4:hell>');
  });

  it('kind=volition-payload (Plan56 alias)', () => {
    expect(redactPayload('hello', 'volition-payload')).toBe('<redacted-volition-payload len:5 first4:hell>');
  });

  it('kind=vasana-deposit (Plan57)', () => {
    expect(redactPayload('seed-impression-data', 'vasana-deposit'))
      .toBe('<redacted-vasana-deposit len:20 first4:seed>');
  });

  it('strips punctuation/whitespace before first-4 extraction', () => {
    expect(redactPayload('!!!  abcd  efg')).toBe('<redacted-plugin-payload len:14 first4:abcd>');
  });

  it('handles short and empty payloads', () => {
    expect(redactPayload('')).toBe('<redacted-plugin-payload len:0 first4:>');
    expect(redactPayload('a')).toBe('<redacted-plugin-payload len:1 first4:a>');
  });

  it('caps first4 at exactly 4 chars', () => {
    expect(redactPayload('abcdefghijkl')).toBe('<redacted-plugin-payload len:12 first4:abcd>');
  });
});

describe('cycle 03-19 γ retrofit — isRedactedPayload predicate', () => {
  it('matches all 3 kinds', () => {
    expect(isRedactedPayload('<redacted-plugin-payload len:5 first4:abcd>')).toBe(true);
    expect(isRedactedPayload('<redacted-volition-payload len:5 first4:abcd>')).toBe(true);
    expect(isRedactedPayload('<redacted-vasana-deposit len:5 first4:abcd>')).toBe(true);
  });

  it('rejects non-canonical strings', () => {
    expect(isRedactedPayload('plain text')).toBe(false);
    expect(isRedactedPayload('<redacted-other-kind len:5 first4:abcd>')).toBe(false);
  });
});
