/**
 * PID file management utilities.
 *
 * Implements the PidManager interface for daemon process tracking.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import type { PidManager } from "./types.js";

/**
 * Implementation of PID file operations.
 */
class PidManagerImpl implements PidManager {
  writePid(pidFile: string, pid: number): void {
    const dir = dirname(pidFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(pidFile, String(pid), "utf-8");
  }

  readPid(pidFile: string): number | null {
    if (!existsSync(pidFile)) {
      return null;
    }

    try {
      const content = readFileSync(pidFile, "utf-8").trim();
      const pid = parseInt(content, 10);

      if (isNaN(pid) || pid <= 0) {
        return null;
      }

      return pid;
    } catch {
      return null;
    }
  }

  deletePid(pidFile: string): void {
    if (existsSync(pidFile)) {
      unlinkSync(pidFile);
    }
  }

  isProcessRunning(pid: number): boolean {
    try {
      // Signal 0 doesn't kill, just checks process existence
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  cleanupStale(pidFile: string, socketPath: string): void {
    const pid = this.readPid(pidFile);

    if (pid === null) {
      // PID file doesn't exist or is invalid, cleanup socket if exists
      if (existsSync(socketPath)) {
        unlinkSync(socketPath);
      }
      return;
    }

    // Check if process is running
    if (!this.isProcessRunning(pid)) {
      // Stale PID file - cleanup both PID and socket
      this.deletePid(pidFile);
      if (existsSync(socketPath)) {
        unlinkSync(socketPath);
      }
    }
    // If process is running, don't cleanup
  }

  listRunningAgents(pidsDir: string): Array<{ agentId: string; pid: number; pidFile: string }> {
    if (!existsSync(pidsDir)) {
      return [];
    }

    const pidFiles = readdirSync(pidsDir).filter(f => f.endsWith('.pid'));
    const running: Array<{ agentId: string; pid: number; pidFile: string }> = [];

    for (const pidFileName of pidFiles) {
      const pidFile = join(pidsDir, pidFileName);
      const pid = this.readPid(pidFile);

      if (pid !== null && this.isProcessRunning(pid)) {
        // Extract agent ID from filename (remove .pid extension)
        const agentId = basename(pidFileName, '.pid');
        running.push({ agentId, pid, pidFile });
      }
    }

    return running;
  }
}

/**
 * Singleton instance of PID manager.
 */
export const pidManager: PidManager = new PidManagerImpl();
