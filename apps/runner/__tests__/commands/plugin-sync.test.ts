/**
 * PluginSyncCommand unit tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ParsedArgs } from "../../src/commands/base.js";
import { PluginSyncCommand } from "../../src/commands/plugin-sync.js";

describe("PluginSyncCommand", () => {
  let tempDir: string;
  let sourceDir: string;
  let targetDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `plugin-sync-test-${Date.now()}`);
    sourceDir = join(tempDir, "source");
    targetDir = join(tempDir, "target");

    await mkdir(sourceDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("Command metadata", () => {
    it("has correct name and description", () => {
      const cmd = new PluginSyncCommand();
      expect(cmd.name).toBe("plugin-sync");
      expect(cmd.description).toBe("Sync plugins from a source repository to system directory");
    });
  });

  describe("Argument validation", () => {
    it("returns error code 1 with missing source path", async () => {
      const cmd = new PluginSyncCommand();
      const args: ParsedArgs = {
        command: "plugin-sync",
        positional: [],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(1);
    });

    it("returns error code 1 with invalid source path", async () => {
      const cmd = new PluginSyncCommand();
      const args: ParsedArgs = {
        command: "plugin-sync",
        positional: [join(tmpdir(), "definitely-nonexistent-" + Date.now())],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(1);
    });
  });

  describe("Plugin sync operations", () => {
    it("syncs valid plugins", async () => {
      // Create a valid plugin in source
      const pluginDir = join(sourceDir, "test-plugin");
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

      const cmd = new PluginSyncCommand();
      const args: ParsedArgs = {
        command: "plugin-sync",
        positional: [sourceDir],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(0);
    });

    it("skips up-to-date plugins", async () => {
      // Create a plugin in source
      const pluginDir = join(sourceDir, "test-plugin");
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

      const cmd = new PluginSyncCommand();
      const args: ParsedArgs = {
        command: "plugin-sync",
        positional: [sourceDir],
        flags: {},
      };

      // First sync
      await cmd.execute(args);

      // Second sync (should skip)
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      const logs = consoleSpy.mock.calls.map(call => call[0]);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(0);
      expect(logs.some(log => typeof log === "string" && log.includes("skipped"))).toBe(true);
    });

    it("handles --dry-run flag", async () => {
      // Create a valid plugin
      const pluginDir = join(sourceDir, "test-plugin");
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

      const cmd = new PluginSyncCommand();
      const args: ParsedArgs = {
        command: "plugin-sync",
        positional: [sourceDir],
        flags: { "dry-run": true },
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      const logs = consoleSpy.mock.calls.map(call => call[0]);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(0);
      // Should either see "dry-run" message or "skipped" in summary
      const hasOutput = logs.some(log => typeof log === "string" && (log.includes("dry-run") || log.includes("skipped")));
      expect(hasOutput).toBe(true);
    });

    it("handles --force flag", async () => {
      // Create a plugin
      const pluginDir = join(sourceDir, "test-plugin");
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

      const cmd = new PluginSyncCommand();

      // First sync
      await cmd.execute({
        command: "plugin-sync",
        positional: [sourceDir],
        flags: {},
      });

      // Force sync (should sync even if up-to-date)
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const exitCode = await cmd.execute({
        command: "plugin-sync",
        positional: [sourceDir],
        flags: { force: true },
      });
      const logs = consoleSpy.mock.calls.map(call => call[0]);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(0);
      expect(logs.some(log => typeof log === "string" && log.includes("synced"))).toBe(true);
    });

    it("handles --verbose flag", async () => {
      // Create a plugin
      const pluginDir = join(sourceDir, "test-plugin");
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

      const cmd = new PluginSyncCommand();
      const args: ParsedArgs = {
        command: "plugin-sync",
        positional: [sourceDir],
        flags: { verbose: true },
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      const logs = consoleSpy.mock.calls.map(call => call[0]);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(0);
      expect(logs.some(log => typeof log === "string" && log.includes("Found"))).toBe(true);
    });

    it("handles empty source directory", async () => {
      const cmd = new PluginSyncCommand();
      const args: ParsedArgs = {
        command: "plugin-sync",
        positional: [sourceDir],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      const logs = consoleSpy.mock.calls.map(call => call[0]);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(0);
      expect(logs.some(log => typeof log === "string" && log.includes("No valid plugins"))).toBe(true);
    });

    it("handles --skip-deps flag", async () => {
      // Create a plugin with external dependency
      const pluginDir = join(sourceDir, "test-plugin");
      await mkdir(join(pluginDir, "dist"), { recursive: true });
      await mkdir(join(pluginDir, "node_modules", "chalk"), { recursive: true });
      await writeFile(
        join(pluginDir, "package.json"),
        JSON.stringify({
          name: "@openstarry-plugin/test-plugin",
          version: "1.0.0",
          main: "dist/index.js",
          dependencies: { chalk: "^5.0.0" },
        }),
        "utf-8"
      );
      await writeFile(join(pluginDir, "dist", "index.js"), "export {};", "utf-8");
      await writeFile(join(pluginDir, "node_modules", "chalk", "index.js"), "module.exports = {};", "utf-8");

      const cmd = new PluginSyncCommand();
      const args: ParsedArgs = {
        command: "plugin-sync",
        positional: [sourceDir],
        flags: { "skip-deps": true },
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(0);
    });

    it("handles mixed plugin states", async () => {
      // Create two plugins
      const plugin1Dir = join(sourceDir, "plugin1");
      await mkdir(join(plugin1Dir, "dist"), { recursive: true });
      await writeFile(
        join(plugin1Dir, "package.json"),
        JSON.stringify({
          name: "@openstarry-plugin/plugin1",
          version: "1.0.0",
          main: "dist/index.js",
        }),
        "utf-8"
      );
      await writeFile(join(plugin1Dir, "dist", "index.js"), "export {};", "utf-8");

      const plugin2Dir = join(sourceDir, "plugin2");
      await mkdir(join(plugin2Dir, "dist"), { recursive: true });
      await writeFile(
        join(plugin2Dir, "package.json"),
        JSON.stringify({
          name: "@openstarry-plugin/plugin2",
          version: "1.0.0",
          main: "dist/index.js",
        }),
        "utf-8"
      );
      await writeFile(join(plugin2Dir, "dist", "index.js"), "export {};", "utf-8");

      const cmd = new PluginSyncCommand();

      // Sync both
      await cmd.execute({
        command: "plugin-sync",
        positional: [sourceDir],
        flags: {},
      });

      // Update plugin1 version
      await writeFile(
        join(plugin1Dir, "package.json"),
        JSON.stringify({
          name: "@openstarry-plugin/plugin1",
          version: "2.0.0",
          main: "dist/index.js",
        }),
        "utf-8"
      );

      // Sync again
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const exitCode = await cmd.execute({
        command: "plugin-sync",
        positional: [sourceDir],
        flags: { verbose: true },
      });
      const logs = consoleSpy.mock.calls.map(call => call[0]);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(0);
      // Should sync plugin1, skip plugin2
      expect(logs.some(log => typeof log === "string" && log.includes("synced"))).toBe(true);
      expect(logs.some(log => typeof log === "string" && log.includes("skipped"))).toBe(true);
    });
  });
});
