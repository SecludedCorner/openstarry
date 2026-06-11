/**
 * Tests for IVedanaSensor extends IVedana conformance (Plan29).
 * @see types/vedana.ts
 */
import { describe, it, expect } from "vitest";
import type { IVedanaSensor } from "../vedana.js";

describe("IVedanaSensor extends IVedana", () => {
  it("requires skandha property", () => {
    // TypeScript compile-time check: IVedanaSensor must have skandha: 'vedana'
    const sensor: IVedanaSensor = {
      skandha: 'vedana',
      id: 'test-sensor',
      channel: 'test-channel',
      sense: () => ({ valence: 0, intensity: 0, type: 'upekkha', source: 'test' }),
    };
    expect(sensor.skandha).toBe('vedana');
    expect(sensor.id).toBe('test-sensor');
  });
});
