import { describe, it, expect } from "vitest";
import { validateConfig } from "../../src/utils/config-validator.js";
import type { IAgentConfig } from "@openstarry/sdk";

const validConfig: IAgentConfig = {
  identity: {
    id: "test-agent",
    name: "Test Agent",
    description: "A test agent",
    version: "0.1.0",
  },
  cognition: {
    provider: "gemini-oauth",
    model: "gemini-2.0-flash",
    temperature: 0.7,
    maxTokens: 8192,
    maxToolRounds: 10,
  },
  capabilities: {
    tools: ["fs.read", "fs.write"],
    allowedPaths: ["/tmp"],
  },
  policy: {
    maxConcurrentTools: 1,
    toolTimeout: 30000,
  },
  memory: {
    slidingWindowSize: 5,
  },
  plugins: [
    { name: "@openstarry-plugin/provider-gemini-oauth" },
  ],
  guide: "default-guide",
};

describe("validateConfig", () => {
  it("should pass valid config", () => {
    const result = validateConfig(validConfig);
    expect(result.valid).toBe(true);
    expect(result.config).toEqual(validConfig);
    expect(result.errors).toBeUndefined();
  });

  it("should reject config with missing required fields", () => {
    const invalidConfig = {
      identity: {
        id: "test",
        name: "Test",
      },
      // Missing cognition, capabilities, plugins
    };
    const result = validateConfig(invalidConfig);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it("should reject empty plugins array", () => {
    const config = {
      ...validConfig,
      plugins: [],
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some(e => e.path === "plugins")).toBe(true);
  });

  it("should reject empty tools array", () => {
    const config: IAgentConfig = {
      ...validConfig,
      capabilities: {
        ...validConfig.capabilities,
        tools: [],
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some(e => e.path === "capabilities.tools")).toBe(true);
  });

  it("should reject negative temperature", () => {
    const config: IAgentConfig = {
      ...validConfig,
      cognition: {
        ...validConfig.cognition,
        temperature: -1,
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("should reject invalid maxToolRounds", () => {
    const config: IAgentConfig = {
      ...validConfig,
      cognition: {
        ...validConfig.cognition,
        maxToolRounds: 0,
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("should reject empty identity id", () => {
    const config = {
      ...validConfig,
      identity: {
        ...validConfig.identity,
        id: "",
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("should reject empty plugin name", () => {
    const config: IAgentConfig = {
      ...validConfig,
      plugins: [{ name: "" }],
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("should handle multiple errors", () => {
    const config = {
      identity: { id: "", name: "" },
      cognition: { provider: "", model: "", maxToolRounds: 0 },
      capabilities: { tools: [] },
      plugins: [],
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(1);
  });

  it("should provide error paths", () => {
    const config = {
      ...validConfig,
      identity: {
        ...validConfig.identity,
        id: "",
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some(e => e.path.includes("identity"))).toBe(true);
  });

  it("should allow empty provider and model (runtime-configurable)", () => {
    const config = {
      ...validConfig,
      cognition: {
        ...validConfig.cognition,
        provider: "",
        model: "",
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
  });

  it("should accept config without optional fields", () => {
    const minimalConfig: IAgentConfig = {
      identity: {
        id: "minimal",
        name: "Minimal",
      },
      cognition: {
        provider: "gemini-oauth",
        model: "gemini-2.0-flash",
      },
      capabilities: {
        tools: ["fs.read"],
      },
      plugins: [
        { name: "@openstarry-plugin/provider-gemini-oauth" },
      ],
    };
    const result = validateConfig(minimalConfig);
    expect(result.valid).toBe(true);
  });

  it("should accept config without allowedPaths", () => {
    const config: IAgentConfig = {
      ...validConfig,
      capabilities: {
        tools: ["fs.read"],
        // allowedPaths omitted - should be warning but not block
      },
    };
    const result = validateConfig(config);
    // Current implementation filters out warnings, so this should pass
    expect(result.valid).toBe(true);
  });

  it("should return warnings without blocking validation", () => {
    const config: IAgentConfig = {
      ...validConfig,
      capabilities: {
        tools: ["fs.read"],
        allowedPaths: [], // Empty allowedPaths should produce warning
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBe(1);
    expect(result.errors![0].severity).toBe("warning");
    expect(result.errors![0].path).toBe("capabilities.allowedPaths");
  });

  it("should distinguish errors from warnings", () => {
    const config: IAgentConfig = {
      ...validConfig,
      capabilities: {
        tools: [], // Error: empty tools
        allowedPaths: [], // Warning: empty allowedPaths
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some(e => e.severity === "error")).toBe(true);
    expect(result.errors!.some(e => e.severity === "warning")).toBe(true);
  });

  it("should pass config with only warnings", () => {
    const config: IAgentConfig = {
      ...validConfig,
      capabilities: {
        tools: ["fs.read"],
        allowedPaths: [], // Warning only
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.config).toBeDefined();
    expect(result.errors).toBeDefined();
    expect(result.errors!.every(e => e.severity === "warning")).toBe(true);
  });
});
