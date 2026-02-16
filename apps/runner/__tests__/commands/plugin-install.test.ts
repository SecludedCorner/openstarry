/**
 * PluginInstallCommand unit tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ParsedArgs } from "../../src/commands/base.js";
import { PluginInstallCommand } from "../../src/commands/plugin-install.js";

describe("PluginInstallCommand", () => {
  describe("Command metadata", () => {
    it("has correct name", () => {
      const cmd = new PluginInstallCommand();
      expect(cmd.name).toBe("plugin-install");
    });

    it("has a description", () => {
      const cmd = new PluginInstallCommand();
      expect(cmd.description).toBeDefined();
      expect(cmd.description.length).toBeGreaterThan(0);
    });
  });

  describe("Argument validation", () => {
    it("returns error code 1 when no name and no --all flag", async () => {
      const cmd = new PluginInstallCommand();
      const args: ParsedArgs = {
        command: "plugin-install",
        positional: [],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(1);
    });

    it("returns error for non-existent plugin name", async () => {
      const cmd = new PluginInstallCommand();
      const args: ParsedArgs = {
        command: "plugin-install",
        positional: ["@openstarry-plugin/zzz-nonexistent"],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(1);
    });
  });

  describe("Name resolution", () => {
    it("resolves short name to full package name", async () => {
      const cmd = new PluginInstallCommand();
      const args: ParsedArgs = {
        command: "plugin-install",
        positional: ["standard-function-fs"],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      // This should succeed or fail on install, but not on "not found in catalog"
      const exitCode = await cmd.execute(args);
      const errorLogs = consoleErrSpy.mock.calls.map(c => c[0]);
      consoleSpy.mockRestore();
      consoleErrSpy.mockRestore();

      // Should not say "not found in catalog"
      expect(errorLogs.some(l => typeof l === "string" && l.includes("not found in catalog"))).toBe(false);
    });

    it("accepts full scoped name", async () => {
      const cmd = new PluginInstallCommand();
      const args: ParsedArgs = {
        command: "plugin-install",
        positional: ["@openstarry-plugin/standard-function-fs"],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await cmd.execute(args);
      const errorLogs = consoleErrSpy.mock.calls.map(c => c[0]);
      consoleSpy.mockRestore();
      consoleErrSpy.mockRestore();

      expect(errorLogs.some(l => typeof l === "string" && l.includes("not found in catalog"))).toBe(false);
    });
  });

  describe("--all flag", () => {
    it("installs all plugins when --all is set", { timeout: 60000 }, async () => {
      const cmd = new PluginInstallCommand();
      const args: ParsedArgs = {
        command: "plugin-install",
        positional: [],
        flags: { all: true },
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      const logs = consoleSpy.mock.calls.map(c => c[0]);
      consoleSpy.mockRestore();
      consoleErrSpy.mockRestore();

      // Should print summary line with "installed", "skipped", "failed"
      expect(logs.some(l => typeof l === "string" && l.includes("Done:"))).toBe(true);
    });
  });
});
