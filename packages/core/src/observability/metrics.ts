/**
 * Lightweight in-memory metrics collector.
 * Core infrastructure for observability — not a plugin.
 */

export interface MetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  timestamp: number;
}

export interface MetricsCollector {
  increment(name: string, delta?: number): void;
  gauge(name: string, value: number): void;
  getSnapshot(): MetricsSnapshot;
  reset(): void;
}

export function createMetricsCollector(): MetricsCollector {
  const counters = new Map<string, number>();
  const gauges = new Map<string, number>();

  return {
    increment(name: string, delta = 1): void {
      counters.set(name, (counters.get(name) ?? 0) + delta);
    },

    gauge(name: string, value: number): void {
      gauges.set(name, value);
    },

    getSnapshot(): MetricsSnapshot {
      return {
        counters: Object.fromEntries(counters),
        gauges: Object.fromEntries(gauges),
        timestamp: Date.now(),
      };
    },

    reset(): void {
      counters.clear();
      gauges.clear();
    },
  };
}
