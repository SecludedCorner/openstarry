/**
 * Plugin Lock File unit tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readLockFile,
  writeLockFile,
  addToLock,
  removeFromLock,
  isInstalled,
} from "../../src/utils/plugin-lock.js";

describe("plugin-lock", () => {
  let tempDir: string;
  let lockPath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `plugin-lock-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    lockPath = join(tempDir, "lock.json");
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("readLockFile", () => {
    it("returns empty lock when file does not exist", async () => {
      const lock = await readLockFile(lockPath);
      expect(lock.version).toBe("1");
      expect(Object.keys(lock.plugins)).toHaveLength(0);
    });

    it("reads existing lock file", async () => {
      await writeFile(
        lockPath,
        JSON.stringify({
          version: "1",
          plugins: {
            "@openstarry-plugin/foo": {
              name: "@openstarry-plugin/foo",
              version: "1.0.0",
              installedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        }),
        "utf-8",
      );
      const lock = await readLockFile(lockPath);
      expect(Object.keys(lock.plugins)).toHaveLength(1);
      expect(lock.plugins["@openstarry-plugin/foo"].version).toBe("1.0.0");
    });

    it("returns empty lock for corrupted JSON", async () => {
      await writeFile(lockPath, "not json{", "utf-8");
      const lock = await readLockFile(lockPath);
      expect(lock.version).toBe("1");
      expect(Object.keys(lock.plugins)).toHaveLength(0);
    });

    it("returns empty lock for missing plugins field", async () => {
      await writeFile(lockPath, JSON.stringify({ version: "1" }), "utf-8");
      const lock = await readLockFile(lockPath);
      expect(Object.keys(lock.plugins)).toHaveLength(0);
    });
  });

  describe("writeLockFile", () => {
    it("writes lock file to disk", async () => {
      const lock = {
        version: "1" as const,
        plugins: {
          "@openstarry-plugin/test": {
            name: "@openstarry-plugin/test",
            version: "1.0.0",
            installedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      };
      await writeLockFile(lock, lockPath);
      expect(existsSync(lockPath)).toBe(true);

      const readBack = await readLockFile(lockPath);
      expect(readBack.plugins["@openstarry-plugin/test"].version).toBe("1.0.0");
    });

    it("creates parent directory if needed", async () => {
      const deepPath = join(tempDir, "nested", "dir", "lock.json");
      await writeLockFile({ version: "1", plugins: {} }, deepPath);
      expect(existsSync(deepPath)).toBe(true);
    });
  });

  describe("addToLock", () => {
    it("adds a new entry to an empty lock", async () => {
      await addToLock("@openstarry-plugin/foo", "1.0.0", lockPath);
      const lock = await readLockFile(lockPath);
      expect(lock.plugins["@openstarry-plugin/foo"]).toBeDefined();
      expect(lock.plugins["@openstarry-plugin/foo"].version).toBe("1.0.0");
      expect(lock.plugins["@openstarry-plugin/foo"].installedAt).toBeDefined();
    });

    it("updates existing entry", async () => {
      await addToLock("@openstarry-plugin/foo", "1.0.0", lockPath);
      await addToLock("@openstarry-plugin/foo", "2.0.0", lockPath);
      const lock = await readLockFile(lockPath);
      expect(lock.plugins["@openstarry-plugin/foo"].version).toBe("2.0.0");
    });

    it("preserves other entries when adding", async () => {
      await addToLock("@openstarry-plugin/foo", "1.0.0", lockPath);
      await addToLock("@openstarry-plugin/bar", "2.0.0", lockPath);
      const lock = await readLockFile(lockPath);
      expect(Object.keys(lock.plugins)).toHaveLength(2);
    });
  });

  describe("removeFromLock", () => {
    it("removes an existing entry", async () => {
      await addToLock("@openstarry-plugin/foo", "1.0.0", lockPath);
      await removeFromLock("@openstarry-plugin/foo", lockPath);
      const lock = await readLockFile(lockPath);
      expect(lock.plugins["@openstarry-plugin/foo"]).toBeUndefined();
    });

    it("is a no-op for non-existent entry", async () => {
      await addToLock("@openstarry-plugin/foo", "1.0.0", lockPath);
      await removeFromLock("@openstarry-plugin/bar", lockPath);
      const lock = await readLockFile(lockPath);
      expect(Object.keys(lock.plugins)).toHaveLength(1);
    });
  });

  describe("isInstalled", () => {
    it("returns true for installed plugin", async () => {
      await addToLock("@openstarry-plugin/foo", "1.0.0", lockPath);
      expect(await isInstalled("@openstarry-plugin/foo", lockPath)).toBe(true);
    });

    it("returns false for non-installed plugin", async () => {
      expect(await isInstalled("@openstarry-plugin/foo", lockPath)).toBe(false);
    });

    it("returns false after removal", async () => {
      await addToLock("@openstarry-plugin/foo", "1.0.0", lockPath);
      await removeFromLock("@openstarry-plugin/foo", lockPath);
      expect(await isInstalled("@openstarry-plugin/foo", lockPath)).toBe(false);
    });
  });
});
