/**
 * Tests for VedanaRegistry.
 * @see infrastructure/vedana-registry.ts
 */
import { describe, it, expect } from "vitest";
import { createVedanaRegistry } from "../vedana-registry.js";
import type { IVedanaSensor, ChannelVedana } from "@openstarry/sdk";

function makeSensor(id: string, channel = "test"): IVedanaSensor {
  return {
    id,
    channel,
    sense: (): ChannelVedana => ({
      valence: 0.5,
      intensity: 0.5,
      type: "sukha",
      source: channel,
    }),
  };
}

describe("VedanaRegistry", () => {
  it("registers and retrieves a sensor", () => {
    const registry = createVedanaRegistry();
    const sensor = makeSensor("s1", "tool-outcome");
    registry.register(sensor);

    const retrieved = registry.get("s1");
    expect(retrieved).toBe(sensor);
  });

  it("lists all registered sensors", () => {
    const registry = createVedanaRegistry();
    registry.register(makeSensor("s1"));
    registry.register(makeSensor("s2"));
    registry.register(makeSensor("s3"));

    expect(registry.list()).toHaveLength(3);
  });

  it("returns undefined for unknown sensor", () => {
    const registry = createVedanaRegistry();
    expect(registry.get("unknown")).toBeUndefined();
  });

  it("removes a sensor", () => {
    const registry = createVedanaRegistry();
    registry.register(makeSensor("s1"));
    expect(registry.remove("s1")).toBe(true);
    expect(registry.get("s1")).toBeUndefined();
    expect(registry.list()).toHaveLength(0);
  });

  it("returns false when removing non-existent sensor", () => {
    const registry = createVedanaRegistry();
    expect(registry.remove("nonexistent")).toBe(false);
  });
});
