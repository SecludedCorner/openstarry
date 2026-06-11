/**
 * agent-composition / quota — Plan54 §8 plugin-layer quota tracking.
 *
 * Plan54 §8 invariants:
 *   - global cap: `MAX_ACTIVE_SUBAGENTS_GLOBAL` (default 64; env 1..1024)
 *   - per-parent cap: `MAX_ACTIVE_SUBAGENTS_PER_PARENT = 8`
 *   - orphan grace window: `ORPHAN_GRACE_WINDOW_MS = 30_000`
 *
 * Backpressure reasons surface via SpawnChildResponse `reason` field:
 *   `spawn_capacity_exhausted` / `parent_quota_exhausted` / `global_quota_exhausted`.
 *
 * @see openstarry_doc/Technical_Specifications/Plan54_AC9_Binding.md §8
 */

import {
  MAX_ACTIVE_SUBAGENTS_PER_PARENT,
  ORPHAN_GRACE_WINDOW_MS,
  resolveMaxActiveSubagentsGlobal,
} from './config.js';

/** Quota check outcome (mirrors SpawnChildResponse.reason taxonomy). */
export type QuotaDecision =
  | { ok: true }
  | { ok: false; reason: 'global_quota_exhausted' | 'parent_quota_exhausted' };

interface QuotaState {
  globalActive: number;
  perParent: Map<string, number>;
  /** spawnId → { parentAgentId, scheduledOrphanCleanupMs } */
  orphanGrace: Map<string, { parentAgentId: string; cleanupAt: number }>;
}

/** Quota tracker — single-process; multi-process topology declared in delivery_report. */
export class QuotaTracker {
  private readonly state: QuotaState = {
    globalActive: 0,
    perParent: new Map(),
    orphanGrace: new Map(),
  };
  private readonly globalCap = resolveMaxActiveSubagentsGlobal();

  /** Check before allocation; returns ok or backpressure reason. */
  checkSpawn(parentAgentId: string): QuotaDecision {
    if (this.state.globalActive >= this.globalCap) {
      return { ok: false, reason: 'global_quota_exhausted' };
    }
    const parentCount = this.state.perParent.get(parentAgentId) ?? 0;
    if (parentCount >= MAX_ACTIVE_SUBAGENTS_PER_PARENT) {
      return { ok: false, reason: 'parent_quota_exhausted' };
    }
    return { ok: true };
  }

  /** Record a successful allocation (caller invokes after checkSpawn ok). */
  acquire(parentAgentId: string): void {
    this.state.globalActive++;
    this.state.perParent.set(parentAgentId, (this.state.perParent.get(parentAgentId) ?? 0) + 1);
  }

  /** Release a slot (lifecycle completed/aborted/orphaned post-grace). */
  release(parentAgentId: string): void {
    if (this.state.globalActive > 0) this.state.globalActive--;
    const cur = this.state.perParent.get(parentAgentId) ?? 0;
    if (cur <= 1) this.state.perParent.delete(parentAgentId);
    else this.state.perParent.set(parentAgentId, cur - 1);
  }

  /**
   * Schedule an orphan grace window: parent terminated; child enters orphaned
   * state; force-cleanup after ORPHAN_GRACE_WINDOW_MS unless reclaimed.
   */
  scheduleOrphan(spawnId: string, parentAgentId: string, now: number = Date.now()): void {
    this.state.orphanGrace.set(spawnId, {
      parentAgentId,
      cleanupAt: now + ORPHAN_GRACE_WINDOW_MS,
    });
  }

  /** Sweep expired orphan grace entries; returns released spawnIds. */
  sweepOrphans(now: number = Date.now()): readonly string[] {
    const released: string[] = [];
    for (const [spawnId, entry] of this.state.orphanGrace) {
      if (entry.cleanupAt <= now) {
        this.release(entry.parentAgentId);
        this.state.orphanGrace.delete(spawnId);
        released.push(spawnId);
      }
    }
    return released;
  }

  /** Observability snapshots (test isolation + dashboards). */
  snapshot(): {
    globalActive: number;
    globalCap: number;
    perParent: ReadonlyMap<string, number>;
    orphanGracePending: number;
  } {
    return {
      globalActive: this.state.globalActive,
      globalCap: this.globalCap,
      perParent: new Map(this.state.perParent),
      orphanGracePending: this.state.orphanGrace.size,
    };
  }

  /** Test-only reset. */
  reset(): void {
    this.state.globalActive = 0;
    this.state.perParent.clear();
    this.state.orphanGrace.clear();
  }
}
