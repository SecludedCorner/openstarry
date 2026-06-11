/**
 * agent-composition / lifecycle — Plan54 §4.2 state machine + hook dispatch.
 *
 * State machine (NAGARJUNA Madhyamaka annotation: saṃvṛti-satya, not paramārtha-satya):
 *
 *   spawned → active → {completed, aborted, orphaned}
 *
 * Lifecycle hooks dispatch via Plan51 hook-registry (cycle 03-15 ratified;
 * first-shipping cycle 03-16 W2-R16 verification). F-13 hook dispatch
 * verifiability extended to AC-9 spawn / lifecycle hooks.
 *
 * @see openstarry_doc/Technical_Specifications/Plan54_AC9_Binding.md §4.2
 * @see apps/runner/src/zod-gate/hook-registry-schemas.ts (Plan51 module)
 */

import type {
  LifecycleEvent,
  LifecycleHandler,
  LifecycleHookEvent,
  LifecycleState,
} from '@openstarry/sdk';

/** Allowed transitions per Plan54 §4.2. Out-of-state edges throw. */
const TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = Object.freeze({
  spawned: ['active', 'aborted'],
  active: ['completed', 'aborted', 'orphaned'],
  completed: [],
  aborted: [],
  orphaned: [],
});

/** State→hook mapping. */
const STATE_TO_HOOK: Readonly<Record<LifecycleState, LifecycleHookEvent>> = Object.freeze({
  spawned: 'onSpawned',
  active: 'onActive',
  completed: 'onCompleted',
  aborted: 'onAborted',
  orphaned: 'onOrphaned',
});

interface SpawnRecord {
  readonly spawnId: string;
  readonly parentAgentId: string;
  readonly childAgentId: string;
  readonly spawnDepth: number;
  state: LifecycleState;
}

/** In-process state machine + hook dispatcher. */
export class LifecycleManager {
  private readonly records = new Map<string, SpawnRecord>();
  private readonly handlers = new Map<LifecycleHookEvent, LifecycleHandler[]>();

  /** Register a handler for a lifecycle hook. */
  registerHandler(event: LifecycleHookEvent, handler: LifecycleHandler): () => void {
    const arr = this.handlers.get(event) ?? [];
    arr.push(handler);
    this.handlers.set(event, arr);
    return () => {
      const cur = this.handlers.get(event) ?? [];
      const idx = cur.indexOf(handler);
      if (idx >= 0) cur.splice(idx, 1);
    };
  }

  /** Open a new lifecycle record at `spawned`. Dispatches `onSpawned`. */
  async open(args: {
    spawnId: string;
    parentAgentId: string;
    childAgentId: string;
    spawnDepth: number;
  }): Promise<void> {
    if (this.records.has(args.spawnId)) {
      throw new Error(`agent-composition.lifecycle: spawnId ${args.spawnId} already open`);
    }
    const record: SpawnRecord = { ...args, state: 'spawned' };
    this.records.set(args.spawnId, record);
    await this.dispatch('onSpawned', record);
  }

  /** Transition a record; dispatches the corresponding hook. */
  async transition(spawnId: string, next: LifecycleState): Promise<void> {
    const rec = this.records.get(spawnId);
    if (!rec) {
      throw new Error(`agent-composition.lifecycle: unknown spawnId ${spawnId}`);
    }
    const allowed = TRANSITIONS[rec.state];
    if (!allowed.includes(next)) {
      throw new Error(
        `agent-composition.lifecycle: invalid transition ${rec.state} → ${next} (allowed: ${allowed.join(', ') || 'none'})`,
      );
    }
    rec.state = next;
    await this.dispatch(STATE_TO_HOOK[next], rec);
  }

  /** Read current state (null if unknown). */
  getState(spawnId: string): LifecycleState | null {
    return this.records.get(spawnId)?.state ?? null;
  }

  /** Snapshot count of active (non-terminal) records. */
  activeCount(): number {
    let n = 0;
    for (const r of this.records.values()) {
      if (r.state === 'spawned' || r.state === 'active') n++;
    }
    return n;
  }

  /** Test-only reset. */
  reset(): void {
    this.records.clear();
    this.handlers.clear();
  }

  private async dispatch(event: LifecycleHookEvent, rec: SpawnRecord): Promise<void> {
    const handlers = this.handlers.get(event) ?? [];
    if (handlers.length === 0) return;
    const evt: LifecycleEvent = {
      state: rec.state,
      spawnId: rec.spawnId,
      parentAgentId: rec.parentAgentId,
      childAgentId: rec.childAgentId,
      spawnDepth: rec.spawnDepth,
      timestamp: Date.now(),
    };
    // Sequential dispatch — preserves ordering (F-13 verifiability).
    for (const h of handlers) {
      await h(evt);
    }
  }
}
