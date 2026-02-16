/**
 * Plugin Scanner unit tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  scanPluginDirectory,
  shouldSyncPlugin,
  syncPlugin,
  readPluginVersion,
  copyPluginWithoutNodeModules,
  sanitizePackageJson,
  hasNonWorkspaceDependencies,
  type PluginInfo,
} from "../../src/utils/plugin-scanner.js";

describe("plugin-scanner", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `plugin-scanner-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("scanPluginDirectory", () => {
    it("finds valid plugins in directory", async () => {
      // Create a valid plugin
      const pluginDir = join(tempDir, "test-plugin");
      await mkdir(join(pluginDir, "dist"), { recursive: true });
      await writeFile(
        join(pluginDir, "package.json"),
        JSON.stringify({
          name: "@openstarry-plugin/test-plugin",
          version: "1.0.0",
          main: "dist/index.js",
        }),
        "utf-8"
      );
      await writeFile(join(pluginDir, "dist", "index.js"), "export {};", "utf-8");

      const result = await scanPluginDirectory(tempDir);

      expect(result.plugins).toHaveLength(1);
      expect(result.plugins[0]).toMatchObject({
        name: "test-plugin",
        packageName: "@openstarry-plugin/test-plugin",
        version: "1.0.0",
        mainEntry: "dist/index.js",
      });
      expect(result.skipped).toHaveLength(0);
    });

    it("skips directories without package.json", async () => {
      const pluginDir = join(tempDir, "no-pkg");
      await mkdir(pluginDir, { recursive: true });

      const result = await scanPluginDirectory(tempDir);

      expect(result.plugins).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toBe("missing_package_json");
    });

    it("skips invalid package names", async () => {
      const pluginDir = join(tempDir, "invalid-plugin");
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, "package.json"),
        JSON.stringify({
          name: "@other-scope/plugin",
          version: "1.0.0",
        }),
        "utf-8"
      );

      const result = await scanPluginDirectory(tempDir);

      expect(result.plugins).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toBe("invalid_package_name");
    });

    it("skips plugins missing dist", async () => {
      const pluginDir = join(tempDir, "no-dist");
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, "package.json"),
        JSON.stringify({
          name: "@openstarry-plugin/no-dist",
          version: "1.0.0",
          main: "dist/index.js",
        }),
        "utf-8"
      );

      const result = await scanPluginDirectory(tempDir);

      expect(result.plugins).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toBe("missing_dist");
    });

    it("returns correct PluginInfo structure", async () => {
      const pluginDir = join(tempDir, "test-plugin");
      await mkdir(join(pluginDir, "dist"), { recursive: true });
      await writeFile(
        join(pluginDir, "package.json"),
        JSON.stringify({
          name: "@openstarry-plugin/test-plugin",
          version: "2.5.0",
          main: "dist/index.js",
        }),
        "utf-8"
      );
      await writeFile(join(pluginDir, "dist", "index.js"), "export {};", "utf-8");

      const result = await scanPluginDirectory(tempDir);

      const plugin = result.plugins[0];
      expect(plugin).toBeDefined();
      expect(plugin.name).toBe("test-plugin");
      expect(plugin.packageName).toBe("@openstarry-plugin/test-plugin");
      expect(plugin.version).toBe("2.5.0");
      expect(plugin.sourcePath).toContain("test-plugin");
      expect(plugin.mainEntry).toBe("dist/index.js");
    });

    it("accepts openstarry-plugin- prefix", async () => {
      const pluginDir = join(tempDir, "test-plugin");
      await mkdir(join(pluginDir, "dist"), { recursive: true });
      await writeFile(
        join(pluginDir, "package.json"),
        JSON.stringify({
          name: "openstarry-plugin-test",
          version: "1.0.0",
          main: "dist/index.js",
        }),
        "utf-8"
      );
      await writeFile(join(pluginDir, "dist", "index.js"), "export {};", "utf-8");

      const result = await scanPluginDirectory(tempDir);

      expect(result.plugins).toHaveLength(1);
      expect(result.plugins[0].packageName).toBe("openstarry-plugin-test");
    });

    it("defaults to dist/index.js when main is not specified", async () => {
      const pluginDir = join(tempDir, "default-main");
      await mkdir(join(pluginDir, "dist"), { recursive: true });
      await writeFile(
        join(pluginDir, "package.json"),
        JSON.stringify({
          name: "@openstarry-plugin/default-main",
          version: "1.0.0",
        }),
        "utf-8"
      );
      await writeFile(join(pluginDir, "dist", "index.js"), "export {};", "utf-8");

      const result = await scanPluginDirectory(tempDir);

      expect(result.plugins).toHaveLength(1);
      expect(result.plugins[0].mainEntry).toBe("dist/index.js");
    });

    it("skips malformed package.json", async () => {
      const pluginDir = join(tempDir, "malformed");
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, "package.json"),
        "{ invalid json",
        "utf-8"
      );

      const result = await scanPluginDirectory(tempDir);

      expect(result.plugins).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toBe("malformed_json");
    });

    it("defaults version to 0.0.0 if missing", async () => {
      const pluginDir = join(tempDir, "no-version");
      await mkdir(join(pluginDir, "dist"), { recursive: true });
      await writeFile(
        join(pluginDir, "package.json"),
        JSON.stringify({
          name: "@openstarry-plugin/no-version",
        }),
        "utf-8"
      );
      await writeFile(join(pluginDir, "dist", "index.js"), "export {};", "utf-8");

      const result = await scanPluginDirectory(tempDir);

      expect(result.plugins).toHaveLength(1);
      expect(result.plugins[0].version).toBe("0.0.0");
    });
  });

  describe("shouldSyncPlugin", () => {
    it("returns true if target does not exist", async () => {
      const source = join(tempDir, "source");
      const target = join(tempDir, "target");

      await mkdir(source, { recursive: true });
      await writeFile(
        join(source, "package.json"),
        JSON.stringify({ version: "1.0.0" }),
        "utf-8"
      );

      const result = await shouldSyncPlugin(source, target);

      expect(result).toBe(true);
    });

    it("returns true if versions differ", async () => {
      const source = join(tempDir, "source");
      const target = join(tempDir, "target");

      await mkdir(source, { recursive: true });
      await writeFile(
        join(source, "package.json"),
        JSON.stringify({ version: "2.0.0" }),
        "utf-8"
      );

      await mkdir(target, { recursive: true });
      await writeFile(
        join(target, "package.json"),
        JSON.stringify({ version: "1.0.0" }),
        "utf-8"
      );

      const result = await shouldSyncPlugin(source, target);

      expect(result).toBe(true);
    });

    it("returns false if versions match", async () => {
      const source = join(tempDir, "source");
      const target = join(tempDir, "target");

      await mkdir(source, { recursive: true });
      await writeFile(
        join(source, "package.json"),
        JSON.stringify({ version: "1.5.0" }),
        "utf-8"
      );

      await mkdir(target, { recursive: true });
      await writeFile(
        join(target, "package.json"),
        JSON.stringify({ version: "1.5.0" }),
        "utf-8"
      );

      const result = await shouldSyncPlugin(source, target);

      expect(result).toBe(false);
    });

    it("returns true if target package.json is malformed", async () => {
      const source = join(tempDir, "source");
      const target = join(tempDir, "target");

      await mkdir(source, { recursive: true });
      await writeFile(
        join(source, "package.json"),
        JSON.stringify({ version: "1.0.0" }),
        "utf-8"
      );

      await mkdir(target, { recursive: true });
      await writeFile(join(target, "package.json"), "{ invalid", "utf-8");

      const result = await shouldSyncPlugin(source, target);

      expect(result).toBe(true);
    });
  });

  describe("syncPlugin", () => {
    it("copies directory recursively (skipDeps)", async () => {
      const source = join(tempDir, "source");
      const target = join(tempDir, "target");

      await mkdir(join(source, "dist"), { recursive: true });
      await writeFile(
        join(source, "package.json"),
        JSON.stringify({ name: "@openstarry-plugin/test", version: "1.0.0" }),
        "utf-8",
      );
      await writeFile(join(source, "dist", "index.js"), "export {};", "utf-8");

      await syncPlugin(source, target, { skipDeps: true });

      expect(existsSync(join(target, "package.json"))).toBe(true);
      expect(existsSync(join(target, "dist", "index.js"))).toBe(true);
    });

    it("removes existing target before copy", async () => {
      const source = join(tempDir, "source");
      const target = join(tempDir, "target");

      // Create target with old content
      await mkdir(join(target, "old"), { recursive: true });
      await writeFile(join(target, "old", "file.txt"), "old", "utf-8");

      // Create source with new content
      await mkdir(join(source, "new"), { recursive: true });
      await writeFile(
        join(source, "package.json"),
        JSON.stringify({ name: "@openstarry-plugin/test" }),
        "utf-8",
      );
      await writeFile(join(source, "new", "file.txt"), "new", "utf-8");

      await syncPlugin(source, target, { skipDeps: true });

      expect(existsSync(join(target, "old", "file.txt"))).toBe(false);
      expect(existsSync(join(target, "new", "file.txt"))).toBe(true);
    });

    it("excludes node_modules from copy", async () => {
      const source = join(tempDir, "source");
      const target = join(tempDir, "target");

      await mkdir(join(source, "dist"), { recursive: true });
      await mkdir(join(source, "node_modules", "chalk"), { recursive: true });
      await writeFile(
        join(source, "package.json"),
        JSON.stringify({ name: "@openstarry-plugin/test", version: "1.0.0" }),
        "utf-8",
      );
      await writeFile(join(source, "dist", "index.js"), "export {};", "utf-8");
      await writeFile(join(source, "node_modules", "chalk", "index.js"), "module.exports = {};", "utf-8");

      await syncPlugin(source, target, { skipDeps: true });

      expect(existsSync(join(target, "dist", "index.js"))).toBe(true);
      expect(existsSync(join(target, "node_modules"))).toBe(false);
    });

    it("sanitizes package.json (removes workspace deps)", async () => {
      const source = join(tempDir, "source");
      const target = join(tempDir, "target");

      await mkdir(join(source, "dist"), { recursive: true });
      await writeFile(
        join(source, "package.json"),
        JSON.stringify({
          name: "@openstarry-plugin/test",
          version: "1.0.0",
          dependencies: {
            "@openstarry/sdk": "workspace:*",
            "@openstarry/core": "link:../../packages/core",
            chalk: "^5.0.0",
          },
          devDependencies: {
            vitest: "^4.0.18",
          },
        }),
        "utf-8",
      );
      await writeFile(join(source, "dist", "index.js"), "export {};", "utf-8");

      await syncPlugin(source, target, { skipDeps: true });

      const pkg = JSON.parse(
        await import("node:fs/promises").then((fs) => fs.readFile(join(target, "package.json"), "utf-8")),
      );

      // workspace deps removed
      expect(pkg.dependencies["@openstarry/sdk"]).toBeUndefined();
      expect(pkg.dependencies["@openstarry/core"]).toBeUndefined();
      // external dep kept
      expect(pkg.dependencies.chalk).toBe("^5.0.0");
      // devDependencies removed
      expect(pkg.devDependencies).toBeUndefined();
    });
  });

  describe("copyPluginWithoutNodeModules", () => {
    it("copies files but excludes node_modules", async () => {
      const source = join(tempDir, "source");
      const target = join(tempDir, "target");

      await mkdir(join(source, "dist"), { recursive: true });
      await mkdir(join(source, "node_modules", "dep"), { recursive: true });
      await writeFile(join(source, "index.js"), "export {};", "utf-8");
      await writeFile(join(source, "node_modules", "dep", "index.js"), "module.exports = {};", "utf-8");

      await copyPluginWithoutNodeModules(source, target);

      expect(existsSync(join(target, "index.js"))).toBe(true);
      expect(existsSync(join(target, "dist"))).toBe(true);
      expect(existsSync(join(target, "node_modules"))).toBe(false);
    });
  });

  describe("sanitizePackageJson", () => {
    it("removes workspace: and link: dependencies", async () => {
      const pluginDir = join(tempDir, "plugin");
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, "package.json"),
        JSON.stringify({
          name: "@openstarry-plugin/test",
          dependencies: {
            "@openstarry/sdk": "workspace:*",
            "@openstarry/core": "link:../../core",
            chalk: "^5.0.0",
          },
        }),
        "utf-8",
      );

      const result = await sanitizePackageJson(pluginDir);

      expect(result).toEqual({ chalk: "^5.0.0" });
    });

    it("removes @openstarry/* internal deps", async () => {
      const pluginDir = join(tempDir, "plugin");
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, "package.json"),
        JSON.stringify({
          name: "@openstarry-plugin/test",
          dependencies: {
            "@openstarry/shared": "^1.0.0",
            zod: "^3.0.0",
          },
        }),
        "utf-8",
      );

      const result = await sanitizePackageJson(pluginDir);

      expect(result).toEqual({ zod: "^3.0.0" });
    });

    it("removes devDependencies", async () => {
      const pluginDir = join(tempDir, "plugin");
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, "package.json"),
        JSON.stringify({
          name: "@openstarry-plugin/test",
          dependencies: {},
          devDependencies: { vitest: "^4.0.18" },
        }),
        "utf-8",
      );

      await sanitizePackageJson(pluginDir);

      const pkg = JSON.parse(
        await import("node:fs/promises").then((fs) => fs.readFile(join(pluginDir, "package.json"), "utf-8")),
      );
      expect(pkg.devDependencies).toBeUndefined();
    });

    it("returns null if no package.json", async () => {
      const pluginDir = join(tempDir, "empty");
      await mkdir(pluginDir, { recursive: true });

      const result = await sanitizePackageJson(pluginDir);

      expect(result).toBeNull();
    });
  });

  describe("hasNonWorkspaceDependencies", () => {
    it("returns true if deps exist", () => {
      expect(hasNonWorkspaceDependencies({ chalk: "^5.0.0" })).toBe(true);
    });

    it("returns false if deps are empty", () => {
      expect(hasNonWorkspaceDependencies({})).toBe(false);
    });
  });

  describe("readPluginVersion", () => {
    it("reads version from package.json", async () => {
      const pluginDir = join(tempDir, "plugin");
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, "package.json"),
        JSON.stringify({ version: "3.2.1" }),
        "utf-8"
      );

      const version = await readPluginVersion(pluginDir);

      expect(version).toBe("3.2.1");
    });

    it("defaults to 0.0.0 if version is missing", async () => {
      const pluginDir = join(tempDir, "plugin");
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, "package.json"),
        JSON.stringify({ name: "test" }),
        "utf-8"
      );

      const version = await readPluginVersion(pluginDir);

      expect(version).toBe("0.0.0");
    });

    it("throws if package.json does not exist", async () => {
      const pluginDir = join(tempDir, "nonexistent");

      await expect(readPluginVersion(pluginDir)).rejects.toThrow("package.json not found");
    });

    it("throws if package.json is malformed", async () => {
      const pluginDir = join(tempDir, "plugin");
      await mkdir(pluginDir, { recursive: true });
      await writeFile(join(pluginDir, "package.json"), "{ invalid", "utf-8");

      await expect(readPluginVersion(pluginDir)).rejects.toThrow("Failed to read package.json");
    });
  });
});
