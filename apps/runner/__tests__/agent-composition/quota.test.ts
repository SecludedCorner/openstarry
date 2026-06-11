/**
 * Plan54 §8 — quota tracker tests.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { QuotaTracker } from '../../src/agent-composition/quota.js';
import {
  MAX_ACTIVE_SUBAGENTS_PER_PARENT,
  ORPHAN_GRACE_WINDOW_MS,
} from '../../src/agent-composition/config.js';

describe('Plan54 §8 — QuotaTracker', () => {
  let q: QuotaTracker;
  beforeEach(() => {
    q = new QuotaTracker();
  });

  it('initial state is zero across all counters', () => {
    const snap = q.snapshot();
    expect(snap.globalActive).toBe(0);
    expect(snap.perParent.size).toBe(0);
    expect(snap.orphanGracePending).toBe(0);
  });

  it('checkSpawn passes when no quota exceeded', () => {
    expect(q.checkSpawn('parent-A')).toEqual({ ok: true });
  });

  it('per-parent quota: rejects after MAX_ACTIVE_SUBAGENTS_PER_PARENT (8)', () => {
    for (let i = 0; i < MAX_ACTIVE_SUBAGENTS_PER_PARENT; i++) {
      expect(q.checkSpawn('parent-A')).toEqual({ ok: true });
      q.acquire('parent-A');
    }
    expect(q.checkSpawn('parent-A')).toEqual({ ok: false, reason: 'parent_quota_exhausted' });
  });

  it('release decrements per-parent counter', () => {
    q.acquire('parent-A');
    q.acquire('parent-A');
    expect(q.snapshot().perParent.get('parent-A')).toBe(2);
    q.release('parent-A');
    expect(q.snapshot().perParent.get('parent-A')).toBe(1);
    q.release('parent-A');
    expect(q.snapshot().perParent.has('parent-A')).toBe(false);
  });

  it('global quota: rejects after global cap (default 64)', () => {
    for (let p = 0; p < 8; p++) {
      for (let i = 0; i < MAX_ACTIVE_SUBAGENTS_PER_PARENT; i++) {
        const parent = `parent-${p}`;
        expect(q.checkSpawn(parent)).toEqual({ ok: true });
        q.acquire(parent);
      }
    }
    // Global = 8 parents × 8 each = 64 (cap reached). 9th parent fails on global.
    expect(q.checkSpawn('parent-X')).toEqual({ ok: false, reason: 'global_quota_exhausted' });
  });

  it('orphan grace: scheduled then swept after window expiry', () => {
    q.acquire('parent-A');
    expect(q.snapshot().globalActive).toBe(1);

    q.scheduleOrphan('spawn-1', 'parent-A', 1_000);
    expect(q.snapshot().orphanGracePending).toBe(1);

    // Before grace window expires
    const releasedEarly = q.sweepOrphans(1_000 + ORPHAN_GRACE_WINDOW_MS - 1);
    expect(releasedEarly).toHaveLength(0);
    expect(q.snapshot().globalActive).toBe(1);

    // After grace window expires
    const released = q.sweepOrphans(1_000 + ORPHAN_GRACE_WINDOW_MS + 1);
    expect(released).toEqual(['spawn-1']);
    expect(q.snapshot().globalActive).toBe(0);
    expect(q.snapshot().orphanGracePending).toBe(0);
  });

  it('reset clears all state', () => {
    q.acquire('parent-A');
    q.scheduleOrphan('spawn-1', 'parent-A');
    q.reset();
    const snap = q.snapshot();
    expect(snap.globalActive).toBe(0);
    expect(snap.perParent.size).toBe(0);
    expect(snap.orphanGracePending).toBe(0);
  });
});
