/**
 * PluginInfoCommand unit tests.
 */

import { describe, it, expect, vi } from "vitest";
import type { ParsedArgs } from "../../src/commands/base.js";
import { PluginInfoCommand } from "../../src/commands/plugin-info.js";

describe("PluginInfoCommand", () => {
  describe("Command metadata", () => {
    it("has correct name", () => {
      const cmd = new PluginInfoCommand();
      expect(cmd.name).toBe("plugin-info");
    });

    it("has a description", () => {
      const cmd = new PluginInfoCommand();
      expect(cmd.description.length).toBeGreaterThan(0);
    });
  });

  describe("Argument validation", () => {
    it("returns error code 1 when no name provided", async () => {
      const cmd = new PluginInfoCommand();
      const args: ParsedArgs = {
        command: "plugin-info",
        positional: [],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(1);
    });
  });

  describe("Plugin info display", () => {
    it("shows info for existing plugin by full name", async () => {
      const cmd = new PluginInfoCommand();
      const args: ParsedArgs = {
        command: "plugin-info",
        positional: ["@openstarry-plugin/standard-function-fs"],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      const logs = consoleSpy.mock.calls.map(c => c[0]);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(0);
      expect(logs.some(l => typeof l === "string" && l.includes("Plugin:"))).toBe(true);
      expect(logs.some(l => typeof l === "string" && l.includes("Version:"))).toBe(true);
      expect(logs.some(l => typeof l === "string" && l.includes("Description:"))).toBe(true);
      expect(logs.some(l => typeof l === "string" && l.includes("Aggregates:"))).toBe(true);
      expect(logs.some(l => typeof l === "string" && l.includes("Tags:"))).toBe(true);
      expect(logs.some(l => typeof l === "string" && l.includes("Status:"))).toBe(true);
    });

    it("resolves short name", async () => {
      const cmd = new PluginInfoCommand();
      const args: ParsedArgs = {
        command: "plugin-info",
        positional: ["standard-function-fs"],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(0);
    });

    it("returns error for non-existent plugin", async () => {
      const cmd = new PluginInfoCommand();
      const args: ParsedArgs = {
        command: "plugin-info",
        positional: ["@openstarry-plugin/nonexistent"],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(1);
    });

    it("shows 'not installed' status for available plugin", async () => {
      const cmd = new PluginInfoCommand();
      const args: ParsedArgs = {
        command: "plugin-info",
        positional: ["standard-function-fs"],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await cmd.execute(args);
      const logs = consoleSpy.mock.calls.map(c => c[0]);
      consoleSpy.mockRestore();

      expect(logs.some(l => typeof l === "string" && l.includes("not installed"))).toBe(true);
    });
  });
});
