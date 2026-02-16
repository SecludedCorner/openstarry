/**
 * PluginUninstallCommand unit tests.
 */

import { describe, it, expect, vi } from "vitest";
import type { ParsedArgs } from "../../src/commands/base.js";
import { PluginUninstallCommand } from "../../src/commands/plugin-uninstall.js";

describe("PluginUninstallCommand", () => {
  describe("Command metadata", () => {
    it("has correct name", () => {
      const cmd = new PluginUninstallCommand();
      expect(cmd.name).toBe("plugin-uninstall");
    });

    it("has a description", () => {
      const cmd = new PluginUninstallCommand();
      expect(cmd.description.length).toBeGreaterThan(0);
    });
  });

  describe("Argument validation", () => {
    it("returns error code 1 when no name provided", async () => {
      const cmd = new PluginUninstallCommand();
      const args: ParsedArgs = {
        command: "plugin-uninstall",
        positional: [],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(1);
    });
  });

  describe("Uninstall flow", () => {
    it("resolves short name to full package name", async () => {
      const cmd = new PluginUninstallCommand();
      const args: ParsedArgs = {
        command: "plugin-uninstall",
        positional: ["standard-function-fs"],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(0);
    });

    it("succeeds for already-uninstalled plugin", async () => {
      const cmd = new PluginUninstallCommand();
      const args: ParsedArgs = {
        command: "plugin-uninstall",
        positional: ["@openstarry-plugin/nonexistent"],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(0);
    });
  });
});
