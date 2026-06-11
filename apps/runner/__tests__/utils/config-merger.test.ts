/**
 * Tests for mergeConfigs() — Plan34 Wave 1.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import type { IAgentConfig, IProjectConfig, IProjectPermissions, IProjectPlugins } from "@openstarry/sdk";
import { mergeConfigs } from "../../src/utils/config-merger.js";
import { ConfigError } from "../../src/utils/permission-validator.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "openstarry-merger-test-"));
}

function makeBaseConfig(overrides?: Partial<IAgentConfig>): IAgentConfig {
  return {
    identity: {
      id: "test-agent",
      name: "System Agent",
      description: "System description",
      version: "1.0.0",
    },
    cognition: {
      provider: "gemini-oauth",
      model: "gemini-2.0-flash",
      temperature: 0.5,
      maxTokens: 8192,
      maxToolRounds: 10,
    },
    capabilities: {
      tools: ["fs.read", "fs.write", "fs.list", "shell.run"],
      allowedPaths: ["/workspace", "/home/user"],
    },
    policy: {
      maxConcurrentTools: 4,
      toolTimeout: 30000,
    },
    memory: {
      slidingWindowSize: 5,
    },
    plugins: [
      { name: "@openstarry-plugin/provider-gemini-oauth" },
      { name: "@openstarry-plugin/standard-function-fs" },
    ],
    confidenceFloor: 0.3,
    ...overrides,
  };
}

describe("mergeConfigs()", () => {
  let tempDir: string;
  let subDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    subDir = join(tempDir, "sub");
    mkdirSync(subDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns system config unchanged when all project params are null", () => {
    const base = makeBaseConfig();
    const result = mergeConfigs(base, null, null, null, tempDir);
    expect(result.identity.name).toBe("System Agent");
    expect(result.capabilities.tools).toEqual(["fs.read", "fs.write", "fs.list", "shell.run"]);
    expect(result.plugins).toHaveLength(2);
  });

  it("does not mutate input systemConfig", () => {
    const base = makeBaseConfig();
    const projectPerms: IProjectPermissions = { maxConcurrentTools: 1 };
    mergeConfigs(base, null, projectPerms, null, tempDir);
    expect(base.policy?.maxConcurrentTools).toBe(4);
  });

  describe("neutral field override", () => {
    it("overrides identity.description with project value", () => {
      const projectConfig: IProjectConfig = {
        identity: { description: "Project-specific description" },
      };
      const result = mergeConfigs(makeBaseConfig(), projectConfig, null, null, tempDir);
      expect(result.identity.description).toBe("Project-specific description");
    });

    it("overrides cognition.temperature with project value", () => {
      const projectConfig: IProjectConfig = {
        cognition: { temperature: 0.2 },
      };
      const result = mergeConfigs(makeBaseConfig(), projectConfig, null, null, tempDir);
      expect(result.cognition.temperature).toBe(0.2);
    });

    it("keeps system value when project field is absent", () => {
      const projectConfig: IProjectConfig = { identity: {} };
      const result = mergeConfigs(makeBaseConfig(), projectConfig, null, null, tempDir);
      expect(result.identity.name).toBe("System Agent");
    });
  });

  describe("security-ceiling: allowedPaths containment intersection", () => {
    it("retains only project paths that are sub-paths of system paths", () => {
      // System allows tempDir; project restricts to subDir
      const base = makeBaseConfig({
        capabilities: { tools: ["fs.read"], allowedPaths: [tempDir] },
      });
      const projectPerms: IProjectPermissions = {
        allowedPaths: ["sub"], // resolve(tempDir, "sub") = subDir
      };
      const result = mergeConfigs(base, null, projectPerms, null, tempDir);
      expect(result.capabilities.allowedPaths).toHaveLength(1);
      expect(result.capabilities.allowedPaths![0]).toBe(subDir);
    });

    it("uses project paths directly when system has no allowedPaths", () => {
      const base = makeBaseConfig({
        capabilities: { tools: ["fs.read"], allowedPaths: undefined },
      });
      const projectPerms: IProjectPermissions = { allowedPaths: ["sub"] };
      const result = mergeConfigs(base, null, projectPerms, null, tempDir);
      expect(result.capabilities.allowedPaths).toHaveLength(1);
      expect(result.capabilities.allowedPaths![0]).toBe(subDir);
    });

    it("throws ConfigError when intersection is empty", () => {
      // System restricts to /workspace; project wants /other which is not a sub-path
      const base = makeBaseConfig({
        capabilities: { tools: ["fs.read"], allowedPaths: ["/workspace"] },
      });
      const projectPerms: IProjectPermissions = {
        allowedPaths: ["unrelated-dir-outside"], // resolves to tempDir/unrelated, not inside /workspace
      };
      expect(() =>
        mergeConfigs(base, null, projectPerms, null, tempDir)
      ).toThrow(ConfigError);
    });
  });

  describe("security-ceiling: maxConcurrentTools min semantics", () => {
    it("uses lower of system and project values", () => {
      const projectPerms: IProjectPermissions = { maxConcurrentTools: 2 };
      const result = mergeConfigs(makeBaseConfig(), null, projectPerms, null, tempDir);
      expect(result.policy?.maxConcurrentTools).toBe(2);
    });

    it("keeps system value when project value is higher", () => {
      const projectPerms: IProjectPermissions = { maxConcurrentTools: 10 };
      const result = mergeConfigs(makeBaseConfig(), null, projectPerms, null, tempDir);
      expect(result.policy?.maxConcurrentTools).toBe(4);
    });

    it("uses project value when system has no maxConcurrentTools", () => {
      const base = makeBaseConfig({ policy: {} });
      const projectPerms: IProjectPermissions = { maxConcurrentTools: 2 };
      const result = mergeConfigs(base, null, projectPerms, null, tempDir);
      expect(result.policy?.maxConcurrentTools).toBe(2);
    });
  });

  describe("security-ceiling: cognition.maxTokens min semantics", () => {
    it("uses lower of system and project values", () => {
      const projectPerms: IProjectPermissions = { maxTokens: 4096 };
      const result = mergeConfigs(makeBaseConfig(), null, projectPerms, null, tempDir);
      expect(result.cognition.maxTokens).toBe(4096);
    });

    it("keeps system value when project value is higher", () => {
      const projectPerms: IProjectPermissions = { maxTokens: 16384 };
      const result = mergeConfigs(makeBaseConfig(), null, projectPerms, null, tempDir);
      expect(result.cognition.maxTokens).toBe(8192);
    });
  });

  describe("security-floor: confidenceFloor max semantics", () => {
    it("uses higher of system and project values", () => {
      const projectPerms: IProjectPermissions = { confidenceFloor: 0.7 };
      const result = mergeConfigs(makeBaseConfig(), null, projectPerms, null, tempDir);
      expect(result.confidenceFloor).toBe(0.7);
    });

    it("keeps system value when project value is lower", () => {
      const projectPerms: IProjectPermissions = { confidenceFloor: 0.1 };
      const result = mergeConfigs(makeBaseConfig(), null, projectPerms, null, tempDir);
      expect(result.confidenceFloor).toBe(0.3);
    });
  });

  describe("plugins.json override (KD-2)", () => {
    it("replaces system plugin list with project plugin list when present", () => {
      const projectPlugins: IProjectPlugins = {
        plugins: [{ name: "@openstarry-plugin/custom" }],
      };
      const result = mergeConfigs(makeBaseConfig(), null, null, projectPlugins, tempDir);
      expect(result.plugins).toHaveLength(1);
      expect(result.plugins[0].name).toBe("@openstarry-plugin/custom");
    });

    it("preserves system plugin list when projectPlugins is null", () => {
      const result = mergeConfigs(makeBaseConfig(), null, null, null, tempDir);
      expect(result.plugins).toHaveLength(2);
    });
  });

  describe("deniedTools filter", () => {
    it("removes denied tools from capabilities.tools", () => {
      const projectPerms: IProjectPermissions = { deniedTools: ["shell.run"] };
      const result = mergeConfigs(makeBaseConfig(), null, projectPerms, null, tempDir);
      expect(result.capabilities.tools).not.toContain("shell.run");
      expect(result.capabilities.tools).toContain("fs.read");
    });
  });

  describe("MAJOR-1: plugin list preserves criticality field", () => {
    it("retains criticality when present in project plugin ref", () => {
      const projectPlugins: IProjectPlugins = {
        plugins: [
          { name: "@openstarry-plugin/important", criticality: "required" },
          { name: "@openstarry-plugin/optional", criticality: "optional-no-effect" },
        ],
      };
      const result = mergeConfigs(makeBaseConfig(), null, null, projectPlugins, tempDir);
      expect(result.plugins).toHaveLength(2);
      expect((result.plugins[0] as Record<string, unknown>).criticality).toBe("required");
      expect((result.plugins[1] as Record<string, unknown>).criticality).toBe("optional-no-effect");
    });

    it("omits criticality when not present in project plugin ref", () => {
      const projectPlugins: IProjectPlugins = {
        plugins: [{ name: "@openstarry-plugin/basic" }],
      };
      const result = mergeConfigs(makeBaseConfig(), null, null, projectPlugins, tempDir);
      expect((result.plugins[0] as Record<string, unknown>).criticality).toBeUndefined();
    });
  });

  describe("SEC-002: empty tools list warning", () => {
    it("produces empty tools list when allowedTools intersection is empty", () => {
      const base = makeBaseConfig({
        capabilities: { tools: ["fs.read", "fs.write"], allowedPaths: [tempDir] },
      });
      const projectPerms: IProjectPermissions = { allowedTools: ["shell.run"] };
      const result = mergeConfigs(base, null, projectPerms, null, tempDir);
      expect(result.capabilities.tools).toEqual([]);
    });

    it("produces empty tools list when all tools are denied", () => {
      const base = makeBaseConfig({
        capabilities: { tools: ["fs.read"], allowedPaths: [tempDir] },
      });
      const projectPerms: IProjectPermissions = { deniedTools: ["fs.read"] };
      const result = mergeConfigs(base, null, projectPerms, null, tempDir);
      expect(result.capabilities.tools).toEqual([]);
    });
  });
});
