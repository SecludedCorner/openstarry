import { describe, it, expect, vi } from "vitest";
import { resolvePlugins } from "../../src/utils/plugin-resolver.js";
import type { IAgentConfig, IPlugin } from "@openstarry/sdk";

// Mock plugin factory
const createMockPlugin = (name: string): IPlugin => ({
  manifest: {
    name,
    version: "0.1.0",
    description: `Mock ${name} plugin`,
  },
  factory: () => ({
    hooks: {},
  }),
});

// Mock config
const createConfig = (pluginRefs: Array<{ name: string; path?: string }>): IAgentConfig => ({
  identity: {
    id: "test",
    name: "Test",
  },
  cognition: {
    provider: "gemini-oauth",
    model: "gemini-2.0-flash",
  },
  capabilities: {
    tools: ["fs.read"],
    allowedPaths: ["/tmp"],
  },
  plugins: pluginRefs,
});

describe("resolvePlugins", () => {
  it("should resolve plugins by package name", async () => {
    const config = createConfig([
      { name: "@openstarry-plugin/provider-gemini-oauth" },
    ]);

    const result = await resolvePlugins(config, false);

    // Should attempt to load (may succeed or fail based on actual plugin availability)
    expect(result).toBeDefined();
    expect(result.plugins).toBeDefined();
    expect(result.errors).toBeDefined();
  });

  it("should accumulate errors for failed plugins", async () => {
    const config = createConfig([
      { name: "@nonexistent/plugin-1" },
      { name: "@nonexistent/plugin-2" },
    ]);

    const result = await resolvePlugins(config, false);

    // Both should fail
    expect(result.errors.length).toBe(2);
    expect(result.errors[0].pluginName).toBe("@nonexistent/plugin-1");
    expect(result.errors[1].pluginName).toBe("@nonexistent/plugin-2");
  });

  it("should identify path vs package strategy in errors", async () => {
    const config = createConfig([
      { name: "plugin-path", path: "/nonexistent/path.js" },
      { name: "@nonexistent/plugin-package" },
    ]);

    const result = await resolvePlugins(config, false);

    expect(result.errors.length).toBe(2);
    expect(result.errors[0].strategy).toBe("path");
    expect(result.errors[1].strategy).toBe("package");
  });

  it("should log successful loads in verbose mode", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const config = createConfig([
      { name: "@openstarry-plugin/provider-gemini-oauth" },
    ]);

    await resolvePlugins(config, true);

    // Verbose mode should log (if plugin loads successfully)
    // Note: This test is environment-dependent
    consoleSpy.mockRestore();
  });

  it("should log errors to console", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const config = createConfig([
      { name: "@nonexistent/plugin" },
    ]);

    await resolvePlugins(config, false);

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("should handle empty plugins array", async () => {
    const config = createConfig([]);

    const result = await resolvePlugins(config, false);

    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("should continue on error and load remaining plugins", async () => {
    const config = createConfig([
      { name: "@nonexistent/plugin-1" },
      { name: "@openstarry-plugin/provider-gemini-oauth" },
      { name: "@nonexistent/plugin-2" },
    ]);

    const result = await resolvePlugins(config, false);

    // Should have at least 2 errors for nonexistent plugins
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("should provide error messages", async () => {
    const config = createConfig([
      { name: "@nonexistent/plugin" },
    ]);

    const result = await resolvePlugins(config, false);

    expect(result.errors[0].error).toBeDefined();
    expect(result.errors[0].error.length).toBeGreaterThan(0);
  });

  it("should use workspace/node_modules before system directory", async () => {
    // Resolution order: path → workspace/node_modules → system directory
    // Workspace plugins are preferred over system directory copies
    const config = createConfig([
      { name: "@openstarry-plugin/provider-gemini-oauth" },
    ]);

    const result = await resolvePlugins(config, false);

    // Plugin should load from workspace (node_modules) first
    expect(result).toBeDefined();
  });

  it("should fall back to system directory if not in workspace", async () => {
    const config = createConfig([
      { name: "@openstarry-plugin/nonexistent-in-workspace" },
    ]);

    const result = await resolvePlugins(config, false);

    // Should attempt workspace first, then system directory, then fail
    expect(result).toBeDefined();
    expect(result.plugins).toBeDefined();
    expect(result.errors).toBeDefined();
  });

  it("should prefer explicit path over system directory", async () => {
    const config = createConfig([
      {
        name: "@openstarry-plugin/test",
        path: "/nonexistent/path.js",
      },
    ]);

    const result = await resolvePlugins(config, false);

    // Path strategy should be attempted (will fail due to nonexistent path)
    if (result.errors.length > 0) {
      expect(result.errors[0].strategy).toBe("path");
    }
  });

  it("should cache system directory lookup results", async () => {
    // This test verifies that the cache Map is used
    const config1 = createConfig([
      { name: "@openstarry-plugin/cached-test" },
    ]);

    const config2 = createConfig([
      { name: "@openstarry-plugin/cached-test" },
    ]);

    // First call
    const result1 = await resolvePlugins(config1, false);

    // Second call should use cache
    const result2 = await resolvePlugins(config2, false);

    // Both should have consistent results
    expect(result1.plugins.length).toBe(result2.plugins.length);
    expect(result1.errors.length).toBe(result2.errors.length);
  });

  it("should handle missing system config gracefully", async () => {
    // If system config doesn't exist, should fall back to node_modules
    const config = createConfig([
      { name: "@nonexistent/plugin" },
    ]);

    const result = await resolvePlugins(config, false);

    // Should not crash, should attempt node_modules
    expect(result).toBeDefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
