import { describe, it, expect } from "vitest";
import { createMetricsCollector } from "./metrics.js";

describe("MetricsCollector", () => {
  it("increment() from zero defaults to 1", () => {
    const metrics = createMetricsCollector();
    metrics.increment("test.counter");
    const snapshot = metrics.getSnapshot();
    expect(snapshot.counters["test.counter"]).toBe(1);
  });

  it("increment() with custom delta", () => {
    const metrics = createMetricsCollector();
    metrics.increment("test.counter", 5);
    const snapshot = metrics.getSnapshot();
    expect(snapshot.counters["test.counter"]).toBe(5);
  });

  it("increment() accumulates multiple calls", () => {
    const metrics = createMetricsCollector();
    metrics.increment("test.counter", 3);
    metrics.increment("test.counter", 7);
    metrics.increment("test.counter"); // +1
    const snapshot = metrics.getSnapshot();
    expect(snapshot.counters["test.counter"]).toBe(11);
  });

  it("gauge() sets absolute value", () => {
    const metrics = createMetricsCollector();
    metrics.gauge("test.gauge", 42);
    const snapshot = metrics.getSnapshot();
    expect(snapshot.gauges["test.gauge"]).toBe(42);
  });

  it("gauge() overwrites previous value", () => {
    const metrics = createMetricsCollector();
    metrics.gauge("test.gauge", 10);
    metrics.gauge("test.gauge", 20);
    const snapshot = metrics.getSnapshot();
    expect(snapshot.gauges["test.gauge"]).toBe(20);
  });

  it("getSnapshot() returns all counters and gauges", () => {
    const metrics = createMetricsCollector();
    metrics.increment("counter.a", 1);
    metrics.increment("counter.b", 2);
    metrics.gauge("gauge.x", 100);
    metrics.gauge("gauge.y", 200);

    const snapshot = metrics.getSnapshot();
    expect(snapshot.counters).toEqual({
      "counter.a": 1,
      "counter.b": 2,
    });
    expect(snapshot.gauges).toEqual({
      "gauge.x": 100,
      "gauge.y": 200,
    });
  });

  it("reset() clears everything", () => {
    const metrics = createMetricsCollector();
    metrics.increment("counter.a", 5);
    metrics.gauge("gauge.x", 100);

    metrics.reset();

    const snapshot = metrics.getSnapshot();
    expect(snapshot.counters).toEqual({});
    expect(snapshot.gauges).toEqual({});
  });

  it("snapshot timestamp is recent (within 1 second)", () => {
    const metrics = createMetricsCollector();
    const before = Date.now();
    const snapshot = metrics.getSnapshot();
    const after = Date.now();

    expect(snapshot.timestamp).toBeGreaterThanOrEqual(before);
    expect(snapshot.timestamp).toBeLessThanOrEqual(after);
    expect(after - snapshot.timestamp).toBeLessThan(1000);
  });
});
