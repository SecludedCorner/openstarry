/**
 * GearArbiterRegistry — manages registered IGearArbiter instances.
 *
 * Map-backed, insertion-order FIFO for same-priority tie-break.
 * Arbiters are registered by plugins and queried by ManoAggregator.
 *
 * @skandha vijnana (識蘊)
 * @see Plan27: Gear Arbiter Registry
 * @module gear-arbiter-registry
 */

import type { IGearArbiter } from "@openstarry/sdk";

export interface GearArbiterRegistry {
  /** Register an arbiter. Replaces existing arbiter with same id. */
  register(arbiter: IGearArbiter): void;
  /** Get an arbiter by id. */
  get(id: string): IGearArbiter | undefined;
  /** List all arbiters in insertion order. */
  list(): IGearArbiter[];
  /** List all arbiters sorted by priority (ascending), FIFO tie-break. */
  listSorted(): IGearArbiter[];
  /** Remove an arbiter by id. Returns true if found and removed. */
  remove(id: string): boolean;
}

export function createGearArbiterRegistry(): GearArbiterRegistry {
  // Map preserves insertion order
  const arbiters = new Map<string, IGearArbiter>();

  return {
    register(arbiter: IGearArbiter): void {
      arbiters.set(arbiter.id, arbiter);
    },

    get(id: string): IGearArbiter | undefined {
      return arbiters.get(id);
    },

    list(): IGearArbiter[] {
      return [...arbiters.values()];
    },

    listSorted(): IGearArbiter[] {
      // Sort by priority ascending; Map insertion order provides FIFO tie-break
      // since Array.prototype.sort is stable in modern JS engines
      return [...arbiters.values()].sort((a, b) => a.priority - b.priority);
    },

    remove(id: string): boolean {
      return arbiters.delete(id);
    },
  };
}
