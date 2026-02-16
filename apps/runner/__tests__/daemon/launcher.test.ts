/**
 * Daemon Launcher Tests
 *
 * Uses a mock daemon entry script to avoid needing a real AgentCore/LLM provider.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnDaemon, setDaemonEntryOverride } from "../../src/daemon/launcher.js";
import { pidManager } from "../../src/daemon/pid-manager.js";
import { isWindows, getDefaultSocketPath, waitForEndpoint } from "../../src/daemon/platform.js";

const MOCK_DAEMON = resolve(
  import.meta.dirname,
  "helpers",
  "mock-daemon-entry.mjs"
);

describe("Daemon Launcher", () => {
  let testDir: string;
  let configPath: string;
  let spawnedPids: number[] = [];

  beforeAll(() => {
    setDaemonEntryOverride(MOCK_DAEMON);
  });

  afterAll(() => {
    setDaemonEntryOverride(null);
  });

  beforeEach(() => {
    testDir = join(tmpdir(), `launcher-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(testDir, { recursive: true });

    configPath = join(testDir, "agent.json");
    writeFileSync(configPath, JSON.stringify({
      identity: { id: "test-agent", name: "Test", description: "Test", version: "0.1.0" },
      cognition: { provider: "test", model: "test", temperature: 0.7, maxTokens: 1000, maxToolRounds: 5 },
      capabilities: { tools: [], allowedPaths: [] },
      policy: { maxConcurrentTools: 1, toolTimeout: 5000 },
      memory: { slidingWindowSize: 5 },
      plugins: [],
      guide: "default",
    }), "utf-8");
  });

  afterEach(() => {
    for (const pid of spawnedPids) {
      try {
        if (pidManager.isProcessRunning(pid)) {
          process.kill(pid, "SIGKILL");
        }
      } catch { /* ignore */ }
    }
    spawnedPids = [];

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("creates PID/socket/log directories if needed", async () => {
    const result = await spawnDaemon({
      agentId: "test-agent",
      configPath,
      statePath: testDir,
    });
    spawnedPids.push(result.pid);

    expect(existsSync(join(testDir, "pids"))).toBe(true);
    expect(existsSync(join(testDir, "logs"))).toBe(true);
    if (!isWindows) {
      expect(existsSync(join(testDir, "sockets"))).toBe(true);
    }
  });

  it("returns valid spawn result", async () => {
    const result = await spawnDaemon({
      agentId: "test-agent",
      configPath,
      statePath: testDir,
    });
    spawnedPids.push(result.pid);

    expect(result.agentId).toBe("test-agent");
    expect(result.pid).toBeGreaterThan(0);
    expect(result.pidFile).toBe(join(testDir, "pids", "test-agent.pid"));
    expect(result.socketPath).toBe(getDefaultSocketPath("test-agent", testDir));
    expect(result.logFile).toBe(join(testDir, "logs", "test-agent.log"));
  });

  it("spawns detached process that stays alive", async () => {
    const result = await spawnDaemon({
      agentId: "test-agent",
      configPath,
      statePath: testDir,
    });
    spawnedPids.push(result.pid);

    // Wait for mock daemon to initialize
    await new Promise((r) => setTimeout(r, 500));

    expect(pidManager.isProcessRunning(result.pid)).toBe(true);
  });

  it("cleans up stale socket before spawn", async () => {
    if (!isWindows) {
      const socketPath = join(testDir, "sockets", "test-agent.sock");
      mkdirSync(join(testDir, "sockets"), { recursive: true });
      writeFileSync(socketPath, "", "utf-8");
    }

    const result = await spawnDaemon({
      agentId: "test-agent",
      configPath,
      statePath: testDir,
    });
    spawnedPids.push(result.pid);

    expect(result.pid).toBeGreaterThan(0);
  });

  it("uses custom paths when provided", async () => {
    const customPidFile = join(testDir, "custom.pid");
    const customLogFile = join(testDir, "custom.log");
    const customSocketPath = join(testDir, "custom.sock");

    const result = await spawnDaemon({
      agentId: "test-agent",
      configPath,
      statePath: testDir,
      pidFile: customPidFile,
      logFile: customLogFile,
      socketPath: customSocketPath,
    });
    spawnedPids.push(result.pid);

    expect(result.pidFile).toBe(customPidFile);
    expect(result.logFile).toBe(customLogFile);
    expect(result.socketPath).toBe(customSocketPath);
  });

  it("passes environment variables to daemon", async () => {
    const result = await spawnDaemon({
      agentId: "test-agent",
      configPath,
      statePath: testDir,
      env: { TEST_VAR: "test-value" },
    });
    spawnedPids.push(result.pid);

    expect(result.pid).toBeGreaterThan(0);
  });

  it("daemon writes PID file on startup", async () => {
    const result = await spawnDaemon({
      agentId: "test-agent",
      configPath,
      statePath: testDir,
    });
    spawnedPids.push(result.pid);

    // Wait for mock daemon to write PID file
    await new Promise((r) => setTimeout(r, 500));

    const savedPid = pidManager.readPid(result.pidFile);
    expect(savedPid).toBe(result.pid);
  });

  it("creates log file", async () => {
    const result = await spawnDaemon({
      agentId: "test-agent",
      configPath,
      statePath: testDir,
    });
    spawnedPids.push(result.pid);

    // Wait for mock daemon to start and produce output
    await new Promise((r) => setTimeout(r, 500));

    expect(existsSync(result.logFile)).toBe(true);
  });
});
