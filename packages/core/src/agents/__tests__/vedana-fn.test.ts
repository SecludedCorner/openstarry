/**
 * BABBAGE Continuity Tests for createVedanaFn (Plan35 W2).
 *
 * BCT-1: Empty VedanaRegistry returns neutral assessment.
 * BCT-4: Sensor that throws returns neutral assessment; error does not propagate.
 */
import { describe, it, expect, vi } from "vitest";
import { createVedanaFn } from "../agent-core.js";
import { createVedanaRegistry } from "../../infrastructure/vedana-registry.js";
import type { IVedanaSensor, ChannelVedana } from "@openstarry/sdk";

function makeSensor(id: string, sense: () => ChannelVedana): IVedanaSensor {
  return { id, channel: "test", sense };
}

describe("createVedanaFn", () => {
  it("BCT-1: empty registry returns neutral assessment", () => {
    const registry = createVedanaRegistry();
    const vedanaFn = createVedanaFn(registry);
    const result = vedanaFn();

    expect(result.aggregate.valence).toBe(0);
    expect(result.aggregate.intensity).toBe(0);
    expect(result.aggregate.type).toBe("upekkha");
    expect(result.pidOutput).toBe(0);
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it("BCT-4: sensor that throws returns neutral assessment without propagating error", () => {
    const registry = createVedanaRegistry();
    const throwingSensor = makeSensor("bad-sensor", () => {
      throw new Error("sensor failure");
    });
    registry.register(throwingSensor);

    const vedanaFn = createVedanaFn(registry);

    expect(() => vedanaFn()).not.toThrow();
    const result = vedanaFn();
    expect(result.aggregate.valence).toBe(0);
    expect(result.aggregate.intensity).toBe(0);
    expect(result.aggregate.type).toBe("upekkha");
    expect(result.pidOutput).toBe(0);
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it("single sensor: aggregate reflects sensor output", () => {
    const registry = createVedanaRegistry();
    registry.register(makeSensor("s1", () => ({
      valence: 0.6, intensity: 0.8, type: "sukha", source: "s1",
    })));

    const vedanaFn = createVedanaFn(registry);
    const result = vedanaFn();

    expect(result.aggregate.valence).toBeCloseTo(0.6);
    expect(result.aggregate.intensity).toBeCloseTo(0.8);
    expect(result.aggregate.type).toBe("sukha");
    expect(result.aggregate.source).toBe("aggregate");
    expect(result.channels).toHaveLength(1);
    expect(result.pidOutput).toBeCloseTo(0.6 * 0.8);
  });

  it("multiple sensors: aggregate is mean valence, max intensity", () => {
    const registry = createVedanaRegistry();
    registry.register(makeSensor("s1", () => ({
      valence: 0.4, intensity: 0.5, type: "sukha", source: "s1",
    })));
    registry.register(makeSensor("s2", () => ({
      valence: -0.2, intensity: 0.9, type: "dukkha", source: "s2",
    })));

    const vedanaFn = createVedanaFn(registry);
    const result = vedanaFn();

    // avgValence = (0.4 + -0.2) / 2 = 0.1 → sukha (>= 0.1 threshold)
    expect(result.aggregate.valence).toBeCloseTo(0.1);
    // maxIntensity = max(0.5, 0.9) = 0.9
    expect(result.aggregate.intensity).toBeCloseTo(0.9);
    expect(result.aggregate.type).toBe("sukha");
    expect(result.channels).toHaveLength(2);
  });

  it("Doc 36 §15: a custom VedanaClassificationConfig changes the classified type", () => {
    const registry = createVedanaRegistry();
    registry.register(makeSensor("s1", () => ({
      valence: 0.3, intensity: 0.5, type: "sukha", source: "s1",
    })));

    // Default config (sukhaThreshold 0.1): valence 0.3 → sukha.
    expect(createVedanaFn(registry)().aggregate.type).toBe("sukha");

    // Wider band (sukhaThreshold 0.4): valence 0.3 falls in the upekkha zone.
    const widened = createVedanaFn(registry, { dukkhaThreshold: -0.4, sukhaThreshold: 0.4 });
    expect(widened().aggregate.type).toBe("upekkha");
  });

  it("healthy sensor alongside throwing sensor: uses only healthy channel", () => {
    const registry = createVedanaRegistry();
    registry.register(makeSensor("ok-sensor", () => ({
      valence: 0.5, intensity: 0.7, type: "sukha", source: "ok",
    })));
    registry.register(makeSensor("bad-sensor", () => {
      throw new Error("failure");
    }));

    const vedanaFn = createVedanaFn(registry);
    const result = vedanaFn();

    expect(result.channels).toHaveLength(1);
    expect(result.aggregate.valence).toBeCloseTo(0.5);
    expect(result.aggregate.type).toBe("sukha");
  });
});
