/**
 * Daemon Launcher — Spawn daemon as detached process.
 *
 * Uses child_process.spawn with detached mode to create background daemon.
 */

import { spawn } from "node:child_process";
import { openSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DaemonSpawnOptions, DaemonSpawnResult } from "./types.js";
import { pidManager } from "./pid-manager.js";
import { getDefaultSocketPath, isNamedPipe } from "./platform.js";

/**
 * Spawn a daemon process in detached mode.
 *
 * @param options Spawn options
 * @returns Daemon spawn result with PID and file paths
 */
export async function spawnDaemon(options: DaemonSpawnOptions): Promise<DaemonSpawnResult> {
  const {
    agentId,
    configPath,
    statePath,
    env = {},
  } = options;

  // Resolve paths
  const pidFile = options.pidFile ?? join(statePath, "pids", `${agentId}.pid`);
  const logFile = options.logFile ?? join(statePath, "logs", `${agentId}.log`);
  const socketPath = options.socketPath ?? getDefaultSocketPath(agentId, statePath);

  // Create directories (synchronously to ensure they exist before proceeding)
  const pidsDir = dirname(pidFile);
  const logsDir = dirname(logFile);

  mkdirSync(pidsDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  // Only create sockets directory for Unix domain sockets (not named pipes)
  if (!isNamedPipe(socketPath)) {
    const socketsDir = dirname(socketPath);
    mkdirSync(socketsDir, { recursive: true });
  }

  // Cleanup stale socket file if exists
  pidManager.cleanupStale(pidFile, socketPath);

  // Open log file synchronously (fd) to avoid async error events from createWriteStream
  const logFd = openSync(logFile, "a");

  // Resolve daemon entry point
  const daemonEntryPath = resolveDaemonEntryPath();

  // Spawn daemon as detached process
  const child = spawn(
    process.execPath,
    [
      daemonEntryPath,
      "--agent-id", agentId,
      "--config", configPath,
      "--pid-file", pidFile,
      "--socket", socketPath,
      "--log-file", logFile,
    ],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, OPENSTARRY_DAEMON: "1", ...env },
    }
  );

  // Detach from parent process
  child.unref();

  const pid = child.pid!;

  // Note: We don't write PID file here - the daemon process writes it itself
  // This ensures atomicity and prevents race conditions

  return {
    pid,
    agentId,
    pidFile,
    socketPath,
    logFile,
  };
}

/**
 * Testing hook: override daemon entry path for unit tests.
 * Call with a path to use a mock daemon script, or null to reset.
 */
let _entryOverride: string | null = null;
export function setDaemonEntryOverride(path: string | null): void {
  _entryOverride = path;
}

/**
 * Resolve the path to the daemon entry point script.
 */
function resolveDaemonEntryPath(): string {
  if (_entryOverride) return _entryOverride;
  // When compiled, daemon-entry.js is in the same directory as launcher.js
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  return join(currentDir, "daemon-entry.js");
}
