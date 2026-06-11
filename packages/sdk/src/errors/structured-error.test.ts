/**
 * structured-error tests — F-16 ENG-FAB v1.9 candidate schema unit coverage.
 */

import { describe, expect, it } from 'vitest';

import {
  StructuredErrorCode,
  LikelyCausePrefix,
  LIKELY_CAUSE_UNKNOWN,
  SUGGESTED_FIX_LOCATION_UNKNOWN,
  STRUCTURED_ERROR_MESSAGE_MAX_LENGTH,
  normalizeErrorCode,
  validateLikelyCausePrefix,
  formatLikelyCause,
  buildStructuredError,
} from './structured-error.js';

describe('F-16 StructuredErrorCode (10-constant closed enum)', () => {
  it('exposes all 10 constants per D-§4-01 UNANIMOUS', () => {
    expect(StructuredErrorCode.ValidationError).toBe('ValidationError');
    expect(StructuredErrorCode.NotFound).toBe('NotFound');
    expect(StructuredErrorCode.Conflict).toBe('Conflict');
    expect(StructuredErrorCode.DependencyFailure).toBe('DependencyFailure');
    expect(StructuredErrorCode.TimeoutError).toBe('TimeoutError');
    expect(StructuredErrorCode.PermissionDenied).toBe('PermissionDenied');
    expect(StructuredErrorCode.InternalError).toBe('InternalError');
    expect(StructuredErrorCode.SchemaDriftDetected).toBe('SchemaDriftDetected');
    expect(StructuredErrorCode.Halt).toBe('Halt');
    expect(StructuredErrorCode.Other).toBe('Other');
  });

  it('normalizeErrorCode round-trips known constants', () => {
    expect(normalizeErrorCode('ValidationError')).toBe('ValidationError');
    expect(normalizeErrorCode('Halt')).toBe('Halt');
  });

  it('normalizeErrorCode falls back to Other (Madhyamaka graceful degradation)', () => {
    expect(normalizeErrorCode('UnknownClass')).toBe('Other');
    expect(normalizeErrorCode('')).toBe('Other');
  });
});

describe('F-16 likely_cause prefix-discipline', () => {
  it('detects all three valid prefixes', () => {
    expect(validateLikelyCausePrefix('verified: x')).toBe(LikelyCausePrefix.Verified);
    expect(validateLikelyCausePrefix('inferred: y')).toBe(LikelyCausePrefix.Inferred);
    expect(validateLikelyCausePrefix('speculation: z')).toBe(LikelyCausePrefix.Speculation);
  });

  it('rejects strings without a valid prefix', () => {
    expect(validateLikelyCausePrefix('plain text without prefix')).toBeNull();
    expect(validateLikelyCausePrefix('Verified: capitalized')).toBeNull();
    expect(validateLikelyCausePrefix('')).toBeNull();
  });

  it('formatLikelyCause concatenates prefix + cause', () => {
    expect(formatLikelyCause(LikelyCausePrefix.Verified, 'reproduced cause')).toBe(
      'verified: reproduced cause',
    );
  });

  it('formatLikelyCause emits sentinel on empty cause', () => {
    expect(formatLikelyCause(LikelyCausePrefix.Speculation, '   ')).toBe(LIKELY_CAUSE_UNKNOWN);
    expect(formatLikelyCause(LikelyCausePrefix.Inferred, '')).toBe(LIKELY_CAUSE_UNKNOWN);
  });
});

describe('F-16 buildStructuredError validation', () => {
  const baseArgs = {
    error: StructuredErrorCode.ValidationError,
    message: 'Schema mismatch.',
    likely_cause: 'verified: caller used schema v1.0',
    suggested_fix_location: 'apps/runner/src/foo.ts#L1-L10',
    context: { plan_id: 'Plan-52' },
    trace_id: 'trace-abc',
  };

  it('builds a valid record', () => {
    const err = buildStructuredError(baseArgs);
    expect(err.error).toBe('ValidationError');
    expect(err.context).toEqual({ plan_id: 'Plan-52' });
    expect(err.trace_id).toBe('trace-abc');
  });

  it('defaults context to {} if omitted', () => {
    const err = buildStructuredError({ ...baseArgs, context: undefined });
    expect(err.context).toEqual({});
  });

  it('rejects empty message', () => {
    expect(() => buildStructuredError({ ...baseArgs, message: '' })).toThrow(/message/);
  });

  it('rejects message > 200 chars', () => {
    const longMsg = 'x'.repeat(STRUCTURED_ERROR_MESSAGE_MAX_LENGTH + 1);
    expect(() => buildStructuredError({ ...baseArgs, message: longMsg })).toThrow(/message/);
  });

  it('rejects likely_cause without valid prefix', () => {
    expect(() =>
      buildStructuredError({ ...baseArgs, likely_cause: 'no prefix here' }),
    ).toThrow(/verified:/);
  });

  it('accepts the speculation:unknown sentinel', () => {
    const err = buildStructuredError({
      ...baseArgs,
      likely_cause: LIKELY_CAUSE_UNKNOWN,
      suggested_fix_location: SUGGESTED_FIX_LOCATION_UNKNOWN,
    });
    expect(err.likely_cause).toBe(LIKELY_CAUSE_UNKNOWN);
    expect(err.suggested_fix_location).toBe('unknown');
  });

  it('rejects empty trace_id', () => {
    expect(() => buildStructuredError({ ...baseArgs, trace_id: '' })).toThrow(/trace_id/);
  });
});
