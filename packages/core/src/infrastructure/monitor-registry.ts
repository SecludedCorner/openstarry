/**
 * MonitorRegistry — manages registered ILoopQualityMonitor instances.
 *
 * Array-backed (monitors have no priority ordering).
 * Provides lifecycle management: startAll(bus) / stopAll().
 *
 * @skandha vijnana (識蘊)
 * @see Plan29: ILoopQualityMonitor + MonitorRegistry
 * @module monitor-registry
 */

import type { ILoopQualityMonitor, EventBus } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("MonitorRegistry");

export interface MonitorRegistry {
  /** Register a monitor. Replaces existing monitor with same id. */
  register(monitor: ILoopQualityMonitor): void;
  /** Remove a monitor by id. Returns true if found and removed. */
  remove(id: string): boolean;
  /** List all registered monitors. */
  list(): ILoopQualityMonitor[];
  /** Start all monitors with the given EventBus. */
  startAll(bus: EventBus): void;
  /** Stop all monitors. */
  stopAll(): void;
}

export function createMonitorRegistry(): MonitorRegistry {
  const monitors = new Map<string, ILoopQualityMonitor>();

  return {
    register(monitor: ILoopQualityMonitor): void {
      monitors.set(monitor.id, monitor);
    },

    remove(id: string): boolean {
      return monitors.delete(id);
    },

    list(): ILoopQualityMonitor[] {
      return [...monitors.values()];
    },

    startAll(bus: EventBus): void {
      for (const monitor of monitors.values()) {
        try {
          monitor.start(bus);
        } catch (err) {
          logger.error(`Monitor "${monitor.id}" failed to start`, { error: String(err) });
        }
      }
    },

    stopAll(): void {
      for (const monitor of monitors.values()) {
        try {
          monitor.stop();
        } catch (err) {
          logger.error(`Monitor "${monitor.id}" failed to stop`, { error: String(err) });
        }
      }
    },
  };
}
