/**
 * checkpoint-manager — Plan46 W2 K-3 framework-level checkpoint orchestration.
 *
 * Orchestrates PluginHooks.onCheckpoint / onRestore across all loaded plugins.
 * Runner-level, zero Core modifications (C46-1). Plugins with neither hook
 * are simply absent from the snapshot map (no-op).
 *
 * Contracts:
 *   - onCheckpoint() never throws (per SDK type doc); null return is skipped.
 *   - onRestore() may throw; the manager catches to preserve fresh-state
 *     fallback semantics (same as SafetyGate/StateTracker internal paths).
 */

import type { PluginHooks, PluginSnapshot } from "@openstarry/sdk";

export interface CheckpointManager {
  checkpoint(): Map<string, PluginSnapshot>;
  restore(snapshots: Map<string, PluginSnapshot>): void;
}

export function createCheckpointManager(
  plugins: Map<string, PluginHooks>,
): CheckpointManager {
  return {
    checkpoint(): Map<string, PluginSnapshot> {
      const snapshots = new Map<string, PluginSnapshot>();
      for (const [name, hooks] of plugins) {
        if (!hooks.onCheckpoint) continue;
        try {
          const snap = hooks.onCheckpoint();
          if (snap) snapshots.set(name, snap);
        } catch {
          // Defensive: the SDK contract says onCheckpoint never throws, but
          // a misbehaving plugin must not poison the whole checkpoint batch.
        }
      }
      return snapshots;
    },
    restore(snapshots: Map<string, PluginSnapshot>): void {
      for (const [name, snapshot] of snapshots) {
        const hooks = plugins.get(name);
        if (!hooks?.onRestore) continue;
        try {
          hooks.onRestore(snapshot);
        } catch {
          // Framework catches — plugin falls back to fresh state.
        }
      }
    },
  };
}
