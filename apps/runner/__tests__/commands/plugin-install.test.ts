/**
 * PluginInstallCommand unit tests.
 *
 * Test isolation (Plan49 C49-M1): CLI-layer tests route through the installPlugin util
 * which reads OPENSTARRY_INSTALL_DIR / OPENSTARRY_LOCK_PATH env vars when no explicit
 * option is passed. We set these per-test-file to a PID-scoped tempDir so parallel
 * vitest threads do not race on ~/.openstarry/plugins/installed/.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ParsedArgs } from "../../src/commands/base.js";
import { PluginInstallCommand } from "../../src/commands/plugin-install.js";

describe("PluginInstallCommand", () => {
  let testHome: string;
  let savedInstallDir: string | undefined;
  let savedLockPath: string | undefined;

  beforeAll(async () => {
    const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    testHome = join(tmpdir(), `plugin-install-cmd-test-${unique}`);
    await mkdir(join(testHome, "installed"), { recursive: true });
    savedInstallDir = process.env.OPENSTARRY_INSTALL_DIR;
    savedLockPath = process.env.OPENSTARRY_LOCK_PATH;
    process.env.OPENSTARRY_INSTALL_DIR = join(testHome, "installed");
    process.env.OPENSTARRY_LOCK_PATH = join(testHome, "lock.json");
  });

  afterAll(async () => {
    if (savedInstallDir === undefined) delete process.env.OPENSTARRY_INSTALL_DIR;
    else process.env.OPENSTARRY_INSTALL_DIR = savedInstallDir;
    if (savedLockPath === undefined) delete process.env.OPENSTARRY_LOCK_PATH;
    else process.env.OPENSTARRY_LOCK_PATH = savedLockPath;
    if (existsSync(testHome)) {
      await rm(testHome, { recursive: true, force: true });
    }
  });

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
    // Real `pnpm install` of all plugins legitimately takes ~55–75s and is
    // environment/disk/network sensitive; the prior 60000ms cap flaked under load
    // (timed out at the 60s boundary on otherwise-green runs). 180s gives headroom.
    it("installs all plugins when --all is set", { timeout: 180000 }, async () => {
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
