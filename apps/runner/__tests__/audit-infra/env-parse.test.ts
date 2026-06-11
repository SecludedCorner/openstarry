/**
 * W0 shared infra — env-parse unit tests.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { envEnum, envInt, envString } from '../../src/audit-infra/env-parse.js';

const KEY = '__PLAN48_ENV_TEST__';

afterEach(() => {
  delete process.env[KEY];
});

describe('envString', () => {
  it('returns fallback when unset or empty', () => {
    delete process.env[KEY];
    expect(envString(KEY, 'fallback')).toBe('fallback');
    process.env[KEY] = '';
    expect(envString(KEY, 'fallback')).toBe('fallback');
  });
  it('returns value when set', () => {
    process.env[KEY] = 'v1';
    expect(envString(KEY, 'fallback')).toBe('v1');
  });
});

describe('envInt', () => {
  it('parses integer', () => {
    process.env[KEY] = '42';
    expect(envInt(KEY, 1)).toBe(42);
  });
  it('falls back on non-integer', () => {
    process.env[KEY] = '42.5';
    expect(envInt(KEY, 1)).toBe(1);
    process.env[KEY] = 'abc';
    expect(envInt(KEY, 1)).toBe(1);
  });
  it('falls back when empty / unset', () => {
    delete process.env[KEY];
    expect(envInt(KEY, 7)).toBe(7);
    process.env[KEY] = '';
    expect(envInt(KEY, 7)).toBe(7);
  });
});

describe('envEnum', () => {
  const levels = ['DEBUG', 'INFO', 'WARN'] as const;
  it('uppercases and validates', () => {
    process.env[KEY] = 'warn';
    expect(envEnum(KEY, levels, 'INFO')).toBe('WARN');
  });
  it('falls back on unknown value', () => {
    process.env[KEY] = 'TRACE';
    expect(envEnum(KEY, levels, 'INFO')).toBe('INFO');
  });
  it('falls back when unset', () => {
    delete process.env[KEY];
    expect(envEnum(KEY, levels, 'INFO')).toBe('INFO');
  });
});
