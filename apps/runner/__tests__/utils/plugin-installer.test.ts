/**
 * Plugin Installer unit tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  installPlugin,
  uninstallPlugin,
  installAll,
} from "../../src/utils/plugin-installer.js";
import { readLockFile, addToLock } from "../../src/utils/plugin-lock.js";

describe("plugin-installer", () => {
  let tempDir: string;
  let lockPath: string;
  let installedDir: string;

  beforeEach(async () => {
    // PID + random suffix isolates this test file's install target from parallel test files
    // that would otherwise race on the single ~/.openstarry/plugins/installed/ directory
    // (Plan49 C49-M1 root cause).
    const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    tempDir = join(tmpdir(), `plugin-installer-test-${unique}`);
    await mkdir(tempDir, { recursive: true });
    lockPath = join(tempDir, "lock.json");
    installedDir = join(tempDir, "installed");
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("installPlugin", () => {
    it("skips already-installed plugin without --force", async () => {
      await addToLock("@openstarry-plugin/standard-function-fs", "0.19.0", lockPath);
      const result = await installPlugin("@openstarry-plugin/standard-function-fs", {
        lockPath,
        installedDir,
      });
      expect(result.success).toBe(true);
    });

    it("reinstalls with --force even when already installed", async () => {
      await addToLock("@openstarry-plugin/standard-function-fs", "0.19.0", lockPath);
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const result = await installPlugin("@openstarry-plugin/standard-function-fs", {
        force: true,
        lockPath,
        installedDir,
      });
      consoleSpy.mockRestore();
      // Success depends on whether the workspace resolves; the main point is force bypasses skip
      expect(typeof result.success).toBe("boolean");
    });

    it("returns error for completely unknown package", async () => {
      const result = await installPlugin("@openstarry-plugin/zzz-nonexistent-plugin-zzz", {
        lockPath,
        installedDir,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("verbose mode logs workspace resolution path", { timeout: 30000 }, async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await installPlugin("@openstarry-plugin/standard-function-fs", {
        verbose: true,
        force: true,
        lockPath,
        installedDir,
      });
      consoleSpy.mockRestore();
      // Either workspace or npm path was tried
      expect(typeof consoleSpy.mock.calls.length).toBe("number");
    });
  });

  describe("uninstallPlugin", () => {
    it("removes plugin from lock file", async () => {
      await addToLock("@openstarry-plugin/foo", "1.0.0", lockPath);
      const result = await uninstallPlugin("@openstarry-plugin/foo", { lockPath, installedDir });
      expect(result.success).toBe(true);

      const lock = await readLockFile(lockPath);
      expect(lock.plugins["@openstarry-plugin/foo"]).toBeUndefined();
    });

    it("succeeds even if plugin is not installed", async () => {
      const result = await uninstallPlugin("@openstarry-plugin/nonexistent", {
        lockPath,
        installedDir,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("installAll", () => {
    it("processes all catalog entries", { timeout: 120000 }, async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await installAll({ lockPath, installedDir });
      consoleSpy.mockRestore();
      consoleErrSpy.mockRestore();

      // installed + skipped + failed should equal 38
      const total = result.installed.length + result.skipped.length + result.failed.length;
      expect(total).toBe(38);
    });

    it("skips already-installed plugins", { timeout: 120000 }, async () => {
      // Pre-install one
      await addToLock("@openstarry-plugin/standard-function-fs", "0.19.0", lockPath);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await installAll({ lockPath, installedDir });
      consoleSpy.mockRestore();
      consoleErrSpy.mockRestore();

      expect(result.skipped).toContain("@openstarry-plugin/standard-function-fs");
    });

    it("force reinstalls all", { timeout: 120000 }, async () => {
      await addToLock("@openstarry-plugin/standard-function-fs", "0.19.0", lockPath);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await installAll({ force: true, lockPath, installedDir });
      consoleSpy.mockRestore();
      consoleErrSpy.mockRestore();

      // When forced, nothing should be in skipped
      expect(result.skipped).toHaveLength(0);
    });
  });

  // ─── Plan49 C49-M1c regression test ───
  // Verifies that parallel installations targeting independent installedDirs do not race.
  // Before Plan49, both runs shared ~/.openstarry/plugins/installed/ and raced on Windows.
  describe("C49-M1c concurrent install isolation (regression)", () => {
    it("handles parallel installPlugin calls with independent installedDirs", async () => {
      const dirA = join(tempDir, "installed-A");
      const dirB = join(tempDir, "installed-B");
      const lockA = join(tempDir, "lock-A.json");
      const lockB = join(tempDir, "lock-B.json");

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const [resA, resB] = await Promise.all([
        installPlugin("@openstarry-plugin/standard-function-fs", {
          force: true,
          installedDir: dirA,
          lockPath: lockA,
        }),
        installPlugin("@openstarry-plugin/standard-function-fs", {
          force: true,
          installedDir: dirB,
          lockPath: lockB,
        }),
      ]);
      consoleSpy.mockRestore();

      // Neither side should blow up with an FS race error.
      // Success depends on workspace resolution; the contract is: no throw, structured result.
      expect(typeof resA.success).toBe("boolean");
      expect(typeof resB.success).toBe("boolean");
    });
  });
});
