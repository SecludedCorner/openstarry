/**
 * PluginListCommand unit tests.
 */

import { describe, it, expect, vi } from "vitest";
import type { ParsedArgs } from "../../src/commands/base.js";
import { PluginListCommand } from "../../src/commands/plugin-list.js";
import * as pluginLock from "../../src/utils/plugin-lock.js";

describe("PluginListCommand", () => {
  describe("Command metadata", () => {
    it("has correct name", () => {
      const cmd = new PluginListCommand();
      expect(cmd.name).toBe("plugin-list");
    });

    it("has a description", () => {
      const cmd = new PluginListCommand();
      expect(cmd.description.length).toBeGreaterThan(0);
    });
  });

  describe("List installed", () => {
    it("shows message when no plugins installed", async () => {
      // Mock readLockFile to return empty lock
      const mockReadLock = vi.spyOn(pluginLock, "readLockFile").mockResolvedValue({
        version: "1",
        plugins: {},
      });

      const cmd = new PluginListCommand();
      const args: ParsedArgs = {
        command: "plugin-list",
        positional: [],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      const logs = consoleSpy.mock.calls.map(c => c[0]);
      consoleSpy.mockRestore();
      mockReadLock.mockRestore();

      expect(exitCode).toBe(0);
      expect(logs.some(l => typeof l === "string" && l.includes("No plugins installed"))).toBe(true);
    });

    it("shows installed plugins when some exist", async () => {
      const mockReadLock = vi.spyOn(pluginLock, "readLockFile").mockResolvedValue({
        version: "1",
        plugins: {
          "@openstarry-plugin/standard-function-fs": {
            name: "@openstarry-plugin/standard-function-fs",
            version: "0.19.0",
            installedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      });

      const cmd = new PluginListCommand();
      const args: ParsedArgs = {
        command: "plugin-list",
        positional: [],
        flags: {},
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      const logs = consoleSpy.mock.calls.map(c => c[0]);
      consoleSpy.mockRestore();
      mockReadLock.mockRestore();

      expect(exitCode).toBe(0);
      expect(logs.some(l => typeof l === "string" && l.includes("Installed plugins"))).toBe(true);
      expect(logs.some(l => typeof l === "string" && l.includes("standard-function-fs"))).toBe(true);
    });
  });

  describe("--all flag", () => {
    it("shows all catalog plugins with status", async () => {
      const mockReadLock = vi.spyOn(pluginLock, "readLockFile").mockResolvedValue({
        version: "1",
        plugins: {},
      });

      const cmd = new PluginListCommand();
      const args: ParsedArgs = {
        command: "plugin-list",
        positional: [],
        flags: { all: true },
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const exitCode = await cmd.execute(args);
      const logs = consoleSpy.mock.calls.map(c => c[0]);
      consoleSpy.mockRestore();
      mockReadLock.mockRestore();

      expect(exitCode).toBe(0);
      expect(logs.some(l => typeof l === "string" && l.includes("Official Plugin Catalog"))).toBe(true);
      expect(logs.some(l => typeof l === "string" && l.includes("[available]"))).toBe(true);
    });

    it("marks installed plugins as [installed]", async () => {
      const mockReadLock = vi.spyOn(pluginLock, "readLockFile").mockResolvedValue({
        version: "1",
        plugins: {
          "@openstarry-plugin/standard-function-fs": {
            name: "@openstarry-plugin/standard-function-fs",
            version: "0.19.0",
            installedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      });

      const cmd = new PluginListCommand();
      const args: ParsedArgs = {
        command: "plugin-list",
        positional: [],
        flags: { all: true },
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await cmd.execute(args);
      const logs = consoleSpy.mock.calls.map(c => c[0]);
      consoleSpy.mockRestore();
      mockReadLock.mockRestore();

      expect(logs.some(l => typeof l === "string" && l.includes("[installed]"))).toBe(true);
      expect(logs.some(l => typeof l === "string" && l.includes("[available]"))).toBe(true);
    });

    it("shows count summary", async () => {
      const mockReadLock = vi.spyOn(pluginLock, "readLockFile").mockResolvedValue({
        version: "1",
        plugins: {},
      });

      const cmd = new PluginListCommand();
      const args: ParsedArgs = {
        command: "plugin-list",
        positional: [],
        flags: { all: true },
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await cmd.execute(args);
      const logs = consoleSpy.mock.calls.map(c => c[0]);
      consoleSpy.mockRestore();
      mockReadLock.mockRestore();

      expect(logs.some(l => typeof l === "string" && l.includes("installed") && l.includes("available"))).toBe(true);
    });
  });
});
