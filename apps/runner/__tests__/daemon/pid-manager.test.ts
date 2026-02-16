/**
 * PID Manager Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { pidManager } from "../../src/daemon/pid-manager.js";

describe("PidManager", () => {
  let testDir: string;
  let pidFile: string;
  let socketPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `pid-manager-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    pidFile = join(testDir, "test.pid");
    socketPath = join(testDir, "test.sock");
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("writePid", () => {
    it("creates parent directories if needed", () => {
      const deepPidFile = join(testDir, "pids", "subdir", "test.pid");
      pidManager.writePid(deepPidFile, 12345);

      expect(existsSync(deepPidFile)).toBe(true);
    });

    it("writes PID correctly", () => {
      pidManager.writePid(pidFile, 12345);

      const content = require("fs").readFileSync(pidFile, "utf-8");
      expect(content).toBe("12345");
    });
  });

  describe("readPid", () => {
    it("returns null for missing file", () => {
      const result = pidManager.readPid(pidFile);
      expect(result).toBe(null);
    });

    it("returns null for invalid content", () => {
      writeFileSync(pidFile, "not-a-number", "utf-8");
      const result = pidManager.readPid(pidFile);
      expect(result).toBe(null);
    });

    it("returns null for negative PID", () => {
      writeFileSync(pidFile, "-123", "utf-8");
      const result = pidManager.readPid(pidFile);
      expect(result).toBe(null);
    });

    it("returns PID for valid file", () => {
      writeFileSync(pidFile, "12345", "utf-8");
      const result = pidManager.readPid(pidFile);
      expect(result).toBe(12345);
    });
  });

  describe("deletePid", () => {
    it("removes PID file", () => {
      writeFileSync(pidFile, "12345", "utf-8");
      expect(existsSync(pidFile)).toBe(true);

      pidManager.deletePid(pidFile);
      expect(existsSync(pidFile)).toBe(false);
    });

    it("does not error when file doesn't exist", () => {
      expect(() => pidManager.deletePid(pidFile)).not.toThrow();
    });
  });

  describe("isProcessRunning", () => {
    it("returns true for current process", () => {
      const result = pidManager.isProcessRunning(process.pid);
      expect(result).toBe(true);
    });

    it("returns false for non-existent PID", () => {
      // Use a very high PID that likely doesn't exist
      const result = pidManager.isProcessRunning(999999);
      expect(result).toBe(false);
    });
  });

  describe("cleanupStale", () => {
    it("removes stale PID and socket when process not running", () => {
      writeFileSync(pidFile, "999999", "utf-8");
      writeFileSync(socketPath, "", "utf-8");

      pidManager.cleanupStale(pidFile, socketPath);

      expect(existsSync(pidFile)).toBe(false);
      expect(existsSync(socketPath)).toBe(false);
    });

    it("does not remove files when process is running", () => {
      writeFileSync(pidFile, String(process.pid), "utf-8");
      writeFileSync(socketPath, "", "utf-8");

      pidManager.cleanupStale(pidFile, socketPath);

      expect(existsSync(pidFile)).toBe(true);
      expect(existsSync(socketPath)).toBe(true);
    });

    it("removes socket when PID file is missing", () => {
      writeFileSync(socketPath, "", "utf-8");

      pidManager.cleanupStale(pidFile, socketPath);

      expect(existsSync(socketPath)).toBe(false);
    });
  });

  describe("listRunningAgents", () => {
    it("returns empty array when directory doesn't exist", () => {
      const nonExistentDir = join(testDir, "nonexistent");
      const result = pidManager.listRunningAgents(nonExistentDir);
      expect(result).toEqual([]);
    });

    it("returns running agents only", () => {
      const pidsDir = join(testDir, "pids");
      mkdirSync(pidsDir);

      // Running agent (current process)
      writeFileSync(join(pidsDir, "agent-1.pid"), String(process.pid), "utf-8");

      // Stale agent
      writeFileSync(join(pidsDir, "agent-2.pid"), "999999", "utf-8");

      const result = pidManager.listRunningAgents(pidsDir);

      expect(result).toHaveLength(1);
      expect(result[0].agentId).toBe("agent-1");
      expect(result[0].pid).toBe(process.pid);
    });

    it("extracts agent ID from filename correctly", () => {
      const pidsDir = join(testDir, "pids");
      mkdirSync(pidsDir);

      writeFileSync(join(pidsDir, "my-agent.pid"), String(process.pid), "utf-8");

      const result = pidManager.listRunningAgents(pidsDir);

      expect(result).toHaveLength(1);
      expect(result[0].agentId).toBe("my-agent");
    });
  });
});
