/**
 * Plan54 §4.2 — LifecycleManager tests.
 *
 * State machine: spawned → active → {completed, aborted, orphaned}.
 * F-13 hook dispatch verifiability extended to AC-9.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { LifecycleManager } from '../../src/agent-composition/lifecycle.js';
import type { LifecycleEvent } from '@openstarry/sdk';

describe('Plan54 §4.2 — LifecycleManager', () => {
  let mgr: LifecycleManager;
  beforeEach(() => {
    mgr = new LifecycleManager();
  });

  it('opens a record at spawned state', async () => {
    await mgr.open({ spawnId: 's1', parentAgentId: 'p1', childAgentId: 'p1/s1', spawnDepth: 1 });
    expect(mgr.getState('s1')).toBe('spawned');
  });

  it('rejects re-opening an already-open spawnId', async () => {
    await mgr.open({ spawnId: 's1', parentAgentId: 'p', childAgentId: 'c', spawnDepth: 1 });
    await expect(
      mgr.open({ spawnId: 's1', parentAgentId: 'p', childAgentId: 'c', spawnDepth: 1 }),
    ).rejects.toThrow(/already open/);
  });

  it('valid transitions: spawned → active → completed', async () => {
    await mgr.open({ spawnId: 's1', parentAgentId: 'p', childAgentId: 'c', spawnDepth: 1 });
    await mgr.transition('s1', 'active');
    expect(mgr.getState('s1')).toBe('active');
    await mgr.transition('s1', 'completed');
    expect(mgr.getState('s1')).toBe('completed');
  });

  it('valid transitions: spawned → aborted (terminal)', async () => {
    await mgr.open({ spawnId: 's1', parentAgentId: 'p', childAgentId: 'c', spawnDepth: 1 });
    await mgr.transition('s1', 'aborted');
    expect(mgr.getState('s1')).toBe('aborted');
  });

  it('valid transitions: active → orphaned', async () => {
    await mgr.open({ spawnId: 's1', parentAgentId: 'p', childAgentId: 'c', spawnDepth: 1 });
    await mgr.transition('s1', 'active');
    await mgr.transition('s1', 'orphaned');
    expect(mgr.getState('s1')).toBe('orphaned');
  });

  it('rejects invalid transition spawned → completed (skipping active)', async () => {
    await mgr.open({ spawnId: 's1', parentAgentId: 'p', childAgentId: 'c', spawnDepth: 1 });
    await expect(mgr.transition('s1', 'completed')).rejects.toThrow(/invalid transition/);
  });

  it('rejects transition from terminal state (completed → anything)', async () => {
    await mgr.open({ spawnId: 's1', parentAgentId: 'p', childAgentId: 'c', spawnDepth: 1 });
    await mgr.transition('s1', 'active');
    await mgr.transition('s1', 'completed');
    await expect(mgr.transition('s1', 'aborted')).rejects.toThrow(/invalid transition/);
  });

  it('rejects transition on unknown spawnId', async () => {
    await expect(mgr.transition('nonexistent', 'active')).rejects.toThrow(/unknown spawnId/);
  });

  it('F-13 verifiability: handlers dispatched on each transition', async () => {
    const events: LifecycleEvent[] = [];
    mgr.registerHandler('onSpawned', (e) => { events.push(e); });
    mgr.registerHandler('onActive', (e) => { events.push(e); });
    mgr.registerHandler('onCompleted', (e) => { events.push(e); });

    await mgr.open({ spawnId: 's1', parentAgentId: 'p', childAgentId: 'p/s1', spawnDepth: 1 });
    await mgr.transition('s1', 'active');
    await mgr.transition('s1', 'completed');

    expect(events.map((e) => e.state)).toEqual(['spawned', 'active', 'completed']);
    expect(events.every((e) => e.spawnId === 's1' && e.parentAgentId === 'p')).toBe(true);
  });

  it('handler unsubscribe stops further dispatch', async () => {
    let count = 0;
    const unsub = mgr.registerHandler('onSpawned', () => { count++; });
    await mgr.open({ spawnId: 's1', parentAgentId: 'p', childAgentId: 'c', spawnDepth: 1 });
    expect(count).toBe(1);
    unsub();
    await mgr.open({ spawnId: 's2', parentAgentId: 'p', childAgentId: 'c', spawnDepth: 1 });
    expect(count).toBe(1); // unchanged after unsub
  });

  it('activeCount excludes terminal states', async () => {
    await mgr.open({ spawnId: 's1', parentAgentId: 'p', childAgentId: 'c1', spawnDepth: 1 });
    await mgr.open({ spawnId: 's2', parentAgentId: 'p', childAgentId: 'c2', spawnDepth: 1 });
    await mgr.transition('s2', 'active');
    expect(mgr.activeCount()).toBe(2);
    await mgr.transition('s1', 'aborted');
    expect(mgr.activeCount()).toBe(1);
    await mgr.transition('s2', 'completed');
    expect(mgr.activeCount()).toBe(0);
  });
});
