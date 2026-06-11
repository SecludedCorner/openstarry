/**
 * Plan56 §7.2 + Batch 15 Item #6 A8 — config tests.
 * NEG-D6: env var out-of-range fallback.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  MAX_VOLITION_QUEUE_DEFAULT,
  resolveMaxVolitionQueue,
  verifyVolitionQueueAudit,
  type VolitionQueueOverrideAudit,
} from '../../src/multi-ivolition/config.js';

describe('Plan56 §7.2 — MAX_VOLITION_QUEUE constants', () => {
  it('default is 16 (within ≥8/≤64 safety band per §7.2)', () => {
    expect(MAX_VOLITION_QUEUE_DEFAULT).toBe(16);
    expect(MAX_VOLITION_QUEUE_DEFAULT).toBeGreaterThanOrEqual(8);
    expect(MAX_VOLITION_QUEUE_DEFAULT).toBeLessThanOrEqual(64);
  });
});

describe('Plan56 §7.2 — resolveMaxVolitionQueue', () => {
  let envSnapshot: string | undefined;
  beforeEach(() => {
    envSnapshot = process.env.OPENSTARRY_MAX_VOLITION_QUEUE;
    delete process.env.OPENSTARRY_MAX_VOLITION_QUEUE;
  });
  afterEach(() => {
    if (envSnapshot !== undefined) process.env.OPENSTARRY_MAX_VOLITION_QUEUE = envSnapshot;
    else delete process.env.OPENSTARRY_MAX_VOLITION_QUEUE;
  });

  it('returns default when env unset', () => {
    expect(resolveMaxVolitionQueue()).toBe(MAX_VOLITION_QUEUE_DEFAULT);
  });

  it('respects in-range env override', () => {
    process.env.OPENSTARRY_MAX_VOLITION_QUEUE = '32';
    const audits: VolitionQueueOverrideAudit[] = [];
    expect(resolveMaxVolitionQueue((e) => audits.push(e))).toBe(32);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.source).toBe('env');
    expect(audits[0]!.outOfRange).toBe(false);
  });

  it('NEG-D6: out-of-range falls back to default + emits structured-error audit', () => {
    process.env.OPENSTARRY_MAX_VOLITION_QUEUE = '0';
    const audits: VolitionQueueOverrideAudit[] = [];
    expect(resolveMaxVolitionQueue((e) => audits.push(e))).toBe(MAX_VOLITION_QUEUE_DEFAULT);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.outOfRange).toBe(true);
    expect(audits[0]!.source).toBe('default');
  });

  it('NEG-D6: above-range falls back to default', () => {
    process.env.OPENSTARRY_MAX_VOLITION_QUEUE = '999';
    const audits: VolitionQueueOverrideAudit[] = [];
    expect(resolveMaxVolitionQueue((e) => audits.push(e))).toBe(MAX_VOLITION_QUEUE_DEFAULT);
    expect(audits[0]!.outOfRange).toBe(true);
  });

  it('NEG-D6: non-integer falls back to default', () => {
    process.env.OPENSTARRY_MAX_VOLITION_QUEUE = 'not-a-number';
    expect(resolveMaxVolitionQueue()).toBe(MAX_VOLITION_QUEUE_DEFAULT);
  });

  it('does NOT emit audit when env unset (default fallthrough)', () => {
    const audits: VolitionQueueOverrideAudit[] = [];
    resolveMaxVolitionQueue((e) => audits.push(e));
    expect(audits).toHaveLength(0);
  });

  it('Item #6 verifyVolitionQueueAudit detects tampering', () => {
    process.env.OPENSTARRY_MAX_VOLITION_QUEUE = '24';
    const audits: VolitionQueueOverrideAudit[] = [];
    resolveMaxVolitionQueue((e) => audits.push(e));
    const original = audits[0]!;
    expect(verifyVolitionQueueAudit(original)).toBe(true);
    const tampered: VolitionQueueOverrideAudit = { ...original, resolvedValue: 99 };
    expect(verifyVolitionQueueAudit(tampered)).toBe(false);
  });
});
