/**
 * Tests for VitakkaWatchdog — N-Gear generalized stall prevention.
 * @see vijnana/vitakka-watchdog.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createVitakkaWatchdog } from "../vitakka-watchdog.js";

describe("VitakkaWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not trigger below cycle limit", () => {
    const watchdog = createVitakkaWatchdog({
      maxConsecutiveGearCycles: { 1: 5 },
      maxGearDurationMs: { 1: 10000 },
    });

    for (let i = 0; i < 4; i++) {
      expect(watchdog.recordGearCycle(1)).toBe(false);
    }

    const state = watchdog.getState();
    expect(state.consecutiveGearCycles[1]).toBe(4);
    expect(state.triggered).toBe(false);
  });

  it("triggers at cycle count limit", () => {
    const watchdog = createVitakkaWatchdog({
      maxConsecutiveGearCycles: { 1: 3 },
      maxGearDurationMs: { 1: 100000 },
    });

    expect(watchdog.recordGearCycle(1)).toBe(false);
    expect(watchdog.recordGearCycle(1)).toBe(false);
    expect(watchdog.recordGearCycle(1)).toBe(true); // 3rd → triggers

    const state = watchdog.getState();
    expect(state.triggered).toBe(true);
    expect(state.triggeredGear).toBe(1);
  });

  it("triggers at duration limit", () => {
    const watchdog = createVitakkaWatchdog({
      maxConsecutiveGearCycles: { 1: 100 },
      maxGearDurationMs: { 1: 1000 },
    });

    watchdog.recordGearCycle(1);
    vi.advanceTimersByTime(1001);
    expect(watchdog.recordGearCycle(1)).toBe(true);
  });

  it("resets on default gear", () => {
    const watchdog = createVitakkaWatchdog({
      maxConsecutiveGearCycles: { 1: 3 },
      maxGearDurationMs: { 1: 10000 },
    });

    watchdog.recordGearCycle(1);
    watchdog.recordGearCycle(1);
    watchdog.resetOnDefaultGear();

    const state = watchdog.getState();
    expect(state.consecutiveGearCycles[1]).toBeUndefined();
    expect(state.gearStartTime[1]).toBeUndefined();
    expect(state.triggered).toBe(false);
    expect(state.triggeredGear).toBeNull();

    // Should be able to count again
    expect(watchdog.recordGearCycle(1)).toBe(false);
    expect(watchdog.recordGearCycle(1)).toBe(false);
    expect(watchdog.recordGearCycle(1)).toBe(true);
  });

  // N-Gear tests
  it("tracks gear 3 independently from gear 1", () => {
    const watchdog = createVitakkaWatchdog({
      maxConsecutiveGearCycles: { 1: 5, 3: 3 },
      maxGearDurationMs: { 1: 10000, 3: 10000 },
    });

    // Gear 1 cycles don't affect gear 3
    watchdog.recordGearCycle(1);
    watchdog.recordGearCycle(1);
    expect(watchdog.recordGearCycle(3)).toBe(false);
    expect(watchdog.recordGearCycle(3)).toBe(false);
    expect(watchdog.recordGearCycle(3)).toBe(true); // gear 3 stalls at 3

    expect(watchdog.getState().triggeredGear).toBe(3);
    // gear 1 still at 2 (not stalled)
    expect(watchdog.getState().consecutiveGearCycles[1]).toBe(2);
  });

  it("does not trigger for gears without configured limits", () => {
    const watchdog = createVitakkaWatchdog({
      maxConsecutiveGearCycles: { 1: 3 },
      maxGearDurationMs: { 1: 1000 },
    });

    // Gear 4 has no limits — never triggers
    for (let i = 0; i < 100; i++) {
      expect(watchdog.recordGearCycle(4)).toBe(false);
    }
  });

  it("per-gear duration limits work independently", () => {
    const watchdog = createVitakkaWatchdog({
      maxConsecutiveGearCycles: { 1: 100, 3: 100 },
      maxGearDurationMs: { 1: 5000, 3: 2000 },
    });

    watchdog.recordGearCycle(1);
    watchdog.recordGearCycle(3);

    vi.advanceTimersByTime(2001);
    // Gear 3 should stall (2001 > 2000), gear 1 should not (2001 < 5000)
    expect(watchdog.recordGearCycle(3)).toBe(true);
    expect(watchdog.recordGearCycle(1)).toBe(false);
  });

  it("resetOnDefaultGear clears all gear tracking", () => {
    const watchdog = createVitakkaWatchdog({
      maxConsecutiveGearCycles: { 1: 10, 3: 10 },
      maxGearDurationMs: { 1: 10000, 3: 10000 },
    });

    watchdog.recordGearCycle(1);
    watchdog.recordGearCycle(3);
    watchdog.recordGearCycle(3);
    watchdog.resetOnDefaultGear();

    const state = watchdog.getState();
    expect(Object.keys(state.consecutiveGearCycles)).toHaveLength(0);
    expect(Object.keys(state.gearStartTime)).toHaveLength(0);
  });
});
