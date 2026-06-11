/**
 * VitakkaWatchdog — prevents samsaric stall (N-Gear generalized).
 *
 * Tracks per-gear consecutive cycles and durations. When any gear
 * exceeds its configured limits, the watchdog triggers a stall signal.
 * On return to default gear, all tracking resets.
 *
 * @skandha vijnana (識蘊)
 * @see Plan27b: N-Gear generalization
 */

import type { VitakkaWatchdogConfig } from "@openstarry/sdk";

export interface VitakkaWatchdogState {
  /** Per-gear consecutive cycle counts */
  readonly consecutiveGearCycles: Record<number, number>;
  /** Per-gear streak start timestamps */
  readonly gearStartTime: Record<number, number | null>;
  /** Whether the watchdog has triggered */
  readonly triggered: boolean;
  /** Which gear triggered the stall (null if not triggered) */
  readonly triggeredGear: number | null;
}

export interface VitakkaWatchdog {
  /** Record a gear cycle. Returns true if watchdog triggers (stall detected). */
  recordGearCycle(gear: number): boolean;
  /** Reset all tracking when returning to default gear. */
  resetOnDefaultGear(): void;
  /** Get current watchdog state. */
  getState(): VitakkaWatchdogState;
}

export function createVitakkaWatchdog(config: VitakkaWatchdogConfig): VitakkaWatchdog {
  const consecutiveGearCycles: Record<number, number> = {};
  const gearStartTime: Record<number, number | null> = {};
  let triggered = false;
  let triggeredGear: number | null = null;

  return {
    recordGearCycle(gear: number): boolean {
      const now = Date.now();

      if (gearStartTime[gear] == null) {
        gearStartTime[gear] = now;
      }

      consecutiveGearCycles[gear] = (consecutiveGearCycles[gear] ?? 0) + 1;

      // Check cycle count limit
      const maxCycles = config.maxConsecutiveGearCycles[gear];
      if (maxCycles != null && consecutiveGearCycles[gear] >= maxCycles) {
        triggered = true;
        triggeredGear = gear;
        return true;
      }

      // Check duration limit
      const maxDuration = config.maxGearDurationMs[gear];
      if (maxDuration != null && now - gearStartTime[gear]! >= maxDuration) {
        triggered = true;
        triggeredGear = gear;
        return true;
      }

      triggered = false;
      triggeredGear = null;
      return false;
    },

    resetOnDefaultGear(): void {
      for (const key of Object.keys(consecutiveGearCycles)) {
        delete consecutiveGearCycles[Number(key)];
      }
      for (const key of Object.keys(gearStartTime)) {
        delete gearStartTime[Number(key)];
      }
      triggered = false;
      triggeredGear = null;
    },

    getState(): VitakkaWatchdogState {
      return {
        consecutiveGearCycles: { ...consecutiveGearCycles },
        gearStartTime: { ...gearStartTime },
        triggered,
        triggeredGear,
      };
    },
  };
}
