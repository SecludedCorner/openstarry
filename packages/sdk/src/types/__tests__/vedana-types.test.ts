/**
 * Tests for Vedana SDK type utilities.
 * @see types/vedana.ts
 */
import { describe, it, expect } from "vitest";
import { classifyVedana, DEFAULT_VEDANA_CONFIG, validateVedanaConfig, toVedanaDimension } from "../vedana.js";
import type { VedanaClassificationConfig, ChannelVedana, VedanaDimension } from "../vedana.js";

describe("classifyVedana", () => {
  it("classifies negative valence as dukkha", () => {
    expect(classifyVedana(-0.5, DEFAULT_VEDANA_CONFIG)).toBe("dukkha");
    expect(classifyVedana(-1.0, DEFAULT_VEDANA_CONFIG)).toBe("dukkha");
    expect(classifyVedana(-0.1, DEFAULT_VEDANA_CONFIG)).toBe("dukkha");
  });

  it("classifies positive valence as sukha", () => {
    expect(classifyVedana(0.5, DEFAULT_VEDANA_CONFIG)).toBe("sukha");
    expect(classifyVedana(1.0, DEFAULT_VEDANA_CONFIG)).toBe("sukha");
    expect(classifyVedana(0.1, DEFAULT_VEDANA_CONFIG)).toBe("sukha");
  });

  it("classifies neutral valence as upekkha", () => {
    expect(classifyVedana(0.0, DEFAULT_VEDANA_CONFIG)).toBe("upekkha");
    expect(classifyVedana(0.05, DEFAULT_VEDANA_CONFIG)).toBe("upekkha");
    expect(classifyVedana(-0.05, DEFAULT_VEDANA_CONFIG)).toBe("upekkha");
  });

  it("respects custom thresholds", () => {
    const config: VedanaClassificationConfig = {
      dukkhaThreshold: -0.3,
      sukhaThreshold: 0.3,
    };
    expect(classifyVedana(-0.2, config)).toBe("upekkha"); // Would be dukkha with default
    expect(classifyVedana(0.2, config)).toBe("upekkha"); // Would be sukha with default
    expect(classifyVedana(-0.3, config)).toBe("dukkha");
    expect(classifyVedana(0.3, config)).toBe("sukha");
  });

  it("handles boundary values exactly at threshold", () => {
    // At exact threshold values: <= for dukkha, >= for sukha
    expect(classifyVedana(-0.1, DEFAULT_VEDANA_CONFIG)).toBe("dukkha");
    expect(classifyVedana(0.1, DEFAULT_VEDANA_CONFIG)).toBe("sukha");
  });
});

describe("DEFAULT_VEDANA_CONFIG", () => {
  it("has expected default values", () => {
    expect(DEFAULT_VEDANA_CONFIG.dukkhaThreshold).toBe(-0.1);
    expect(DEFAULT_VEDANA_CONFIG.sukhaThreshold).toBe(0.1);
  });
});

describe("validateVedanaConfig", () => {
  it("passes for valid config", () => {
    expect(() => validateVedanaConfig(DEFAULT_VEDANA_CONFIG)).not.toThrow();
  });

  it("throws when dukkhaThreshold >= sukhaThreshold", () => {
    expect(() => validateVedanaConfig({ dukkhaThreshold: 0.5, sukhaThreshold: 0.1 })).toThrow(
      "must be less than"
    );
  });

  it("throws when thresholds are equal", () => {
    expect(() => validateVedanaConfig({ dukkhaThreshold: 0.0, sukhaThreshold: 0.0 })).toThrow(
      "must be less than"
    );
  });

  // Doc 36 §13 hard safety bounds (prevent force-permanent-upekkha DoS).
  it("throws when dukkhaThreshold is below the -0.5 hard bound", () => {
    expect(() => validateVedanaConfig({ dukkhaThreshold: -0.6, sukhaThreshold: 0.1 })).toThrow(
      /dukkhaThreshold .* must be >= -0\.5/
    );
  });

  it("throws when sukhaThreshold is above the +0.5 hard bound", () => {
    expect(() => validateVedanaConfig({ dukkhaThreshold: -0.1, sukhaThreshold: 0.6 })).toThrow(
      /sukhaThreshold .* must be <= 0\.5/
    );
  });

  it("accepts the boundary values -0.5 / +0.5 (max band 1.0)", () => {
    expect(() => validateVedanaConfig({ dukkhaThreshold: -0.5, sukhaThreshold: 0.5 })).not.toThrow();
  });
});

describe("VedanaDimension", () => {
  it("toVedanaDimension converts ChannelVedana correctly", () => {
    const vedana: ChannelVedana = {
      valence: 0.5,
      intensity: 0.8,
      type: "sukha",
      source: "test",
    };
    const dim: VedanaDimension = toVedanaDimension(vedana);
    expect(dim.valence).toBe(0.5);
    expect(dim.arousal).toBe(0.8); // maps from intensity
    expect(dim.dominance).toBe(0.5); // default neutral
  });

  it("toVedanaDimension preserves negative valence", () => {
    const vedana: ChannelVedana = {
      valence: -0.7,
      intensity: 0.3,
      type: "dukkha",
      source: "test",
    };
    const dim = toVedanaDimension(vedana);
    expect(dim.valence).toBe(-0.7);
    expect(dim.arousal).toBe(0.3);
  });
});
