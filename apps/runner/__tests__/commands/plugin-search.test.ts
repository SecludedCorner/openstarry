/**
 * PluginSearchCommand unit tests.
 */

import { describe, it, expect, vi } from "vitest";
import type { ParsedArgs } from "../../src/commands/base.js";
import { PluginSearchCommand } from "../../src/commands/plugin-search.js";

describe("PluginSearchCommand", () => {
  describe("Command metadata", () => {
    it("has correct name", () => {
      const cmd = new PluginSearchCommand();
      expect(cmd.name).toBe("plugin-search");
    });

    it("has a description", () => {
      const cmd = new PluginSearchCommand();
      expect(cmd.description.length).toBeGreaterThan(0);
    });
  });

  describe("Argument validation", () => {
    it("returns error code 1 when no query provided", async () => {
      const cmd = new PluginSearchCommand();
      const args: ParsedArgs = {
        command: "plugin-search",
        positional: [],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(1);
    });
  });

  describe("Search results", () => {
    it("finds plugins matching a query", async () => {
      const cmd = new PluginSearchCommand();
      const args: ParsedArgs = {
        command: "plugin-search",
        positional: ["transport"],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      const logs = consoleSpy.mock.calls.map(c => c[0]);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(0);
      expect(logs.some(l => typeof l === "string" && l.includes("Found"))).toBe(true);
    });

    it("shows no-results message for unmatched query", async () => {
      const cmd = new PluginSearchCommand();
      const args: ParsedArgs = {
        command: "plugin-search",
        positional: ["zzz_no_match_zzz"],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      const logs = consoleSpy.mock.calls.map(c => c[0]);
      consoleSpy.mockRestore();

      expect(exitCode).toBe(0);
      expect(logs.some(l => typeof l === "string" && l.includes("No plugins found"))).toBe(true);
    });

    it("displays aggregates and tags for results", async () => {
      const cmd = new PluginSearchCommand();
      const args: ParsedArgs = {
        command: "plugin-search",
        positional: ["gemini"],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await cmd.execute(args);
      const logs = consoleSpy.mock.calls.map(c => c[0]);
      consoleSpy.mockRestore();

      expect(logs.some(l => typeof l === "string" && l.includes("Aggregates:"))).toBe(true);
      expect(logs.some(l => typeof l === "string" && l.includes("Tags:"))).toBe(true);
    });
  });
});
