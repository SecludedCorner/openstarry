/**
 * Daemon Lifecycle Integration Tests
 *
 * Uses a mock daemon entry script for deterministic testing.
 * Tests the full daemon lifecycle: spawn → IPC → stop.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnDaemon, setDaemonEntryOverride } from "../../src/daemon/launcher.js";
import { pidManager } from "../../src/daemon/pid-manager.js";
import { IPCClientImpl } from "../../src/daemon/ipc-client.js";
import { waitForEndpoint, isWindows, getDefaultSocketPath } from "../../src/daemon/platform.js";

const MOCK_DAEMON = resolve(
  import.meta.dirname,
  "helpers",
  "mock-daemon-entry.mjs"
);

describe("Daemon Lifecycle", () => {
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
    testDir = join(tmpdir(), `lifecycle-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

  afterEach(async () => {
    for (const pid of spawnedPids) {
      try {
        if (pidManager.isProcessRunning(pid)) {
          process.kill(pid, "SIGKILL");
        }
      } catch { /* ignore */ }
    }
    spawnedPids = [];

    // Small delay for cleanup
    await new Promise((r) => setTimeout(r, 200));

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("full lifecycle: spawn -> ping -> stop", async () => {
    const result = await spawnDaemon({
      agentId: "test-agent",
      configPath,
      statePath: testDir,
    });
    spawnedPids.push(result.pid);

    await waitForEndpoint(result.socketPath);

    const client = new IPCClientImpl({ socketPath: result.socketPath, timeoutMs: 5000 });
    await client.connect();

    const pingResult = await client.call("agent.ping");
    expect(pingResult).toEqual({ pong: true });

    await client.call("agent.stop");
    client.close();

    await new Promise((r) => setTimeout(r, 1000));

    expect(pidManager.isProcessRunning(result.pid)).toBe(false);
  });

  it("daemon survives parent scope (detached)", async () => {
    const result = await spawnDaemon({
      agentId: "test-agent",
      configPath,
      statePath: testDir,
    });
    spawnedPids.push(result.pid);

    await waitForEndpoint(result.socketPath);

    expect(pidManager.isProcessRunning(result.pid)).toBe(true);
  });

  it("IPC agent.status returns correct data", async () => {
    const result = await spawnDaemon({
      agentId: "test-agent",
      configPath,
      statePath: testDir,
    });
    spawnedPids.push(result.pid);

    await waitForEndpoint(result.socketPath);

    const client = new IPCClientImpl({ socketPath: result.socketPath, timeoutMs: 5000 });
    await client.connect();

    const status: any = await client.call("agent.status");
    expect(status.agentId).toBe("test-agent");
    expect(status.pid).toBe(result.pid);
    expect(status.status).toBe("running");

    client.close();
  });

  it("SIGTERM triggers graceful shutdown", async () => {
    const result = await spawnDaemon({
      agentId: "test-agent",
      configPath,
      statePath: testDir,
    });
    spawnedPids.push(result.pid);

    await waitForEndpoint(result.socketPath);

    if (isWindows) {
      // Windows does not support SIGTERM; use IPC agent.stop instead
      const client = new IPCClientImpl({ socketPath: result.socketPath, timeoutMs: 5000 });
      await client.connect();
      await client.call("agent.stop");
      client.close();
    } else {
      process.kill(result.pid, "SIGTERM");
    }

    await new Promise((r) => setTimeout(r, 2000));

    expect(pidManager.isProcessRunning(result.pid)).toBe(false);
    expect(existsSync(result.pidFile)).toBe(false);
  });

  it("stale PID cleanup on startup", async () => {
    const pidFile = join(testDir, "pids", "test-agent.pid");
    const socketPath = getDefaultSocketPath("test-agent", testDir);

    mkdirSync(join(testDir, "pids"), { recursive: true });
    if (!isWindows) {
      mkdirSync(join(testDir, "sockets"), { recursive: true });
      writeFileSync(socketPath, "", "utf-8");
    }

    writeFileSync(pidFile, "999999", "utf-8");

    const result = await spawnDaemon({
      agentId: "test-agent",
      configPath,
      statePath: testDir,
      socketPath,
    });
    spawnedPids.push(result.pid);

    await waitForEndpoint(result.socketPath);

    expect(pidManager.isProcessRunning(result.pid)).toBe(true);
  });

  it("multiple daemons with different agent IDs", async () => {
    const config2Path = join(testDir, "agent2.json");
    writeFileSync(config2Path, JSON.stringify({
      identity: { id: "agent-2", name: "Agent 2", description: "Test", version: "0.1.0" },
      cognition: { provider: "test", model: "test", temperature: 0.7, maxTokens: 1000, maxToolRounds: 5 },
      capabilities: { tools: [], allowedPaths: [] },
      policy: { maxConcurrentTools: 1, toolTimeout: 5000 },
      memory: { slidingWindowSize: 5 },
      plugins: [],
      guide: "default",
    }), "utf-8");

    const r1 = await spawnDaemon({ agentId: "agent-1", configPath, statePath: testDir });
    const r2 = await spawnDaemon({ agentId: "agent-2", configPath: config2Path, statePath: testDir });
    spawnedPids.push(r1.pid, r2.pid);

    await waitForEndpoint(r1.socketPath);
    await waitForEndpoint(r2.socketPath);

    expect(pidManager.isProcessRunning(r1.pid)).toBe(true);
    expect(pidManager.isProcessRunning(r2.pid)).toBe(true);

    const running = pidManager.listRunningAgents(join(testDir, "pids"));
    expect(running.length).toBe(2);
  });

  it("daemon crash leaves stale files", async () => {
    const result = await spawnDaemon({
      agentId: "test-agent",
      configPath,
      statePath: testDir,
    });
    spawnedPids.push(result.pid);

    await waitForEndpoint(result.socketPath);

    process.kill(result.pid, "SIGKILL");
    await new Promise((r) => setTimeout(r, 500));

    expect(pidManager.isProcessRunning(result.pid)).toBe(false);
    expect(existsSync(result.pidFile)).toBe(true);
  });

  it("next startup cleans stale files after crash", async () => {
    const r1 = await spawnDaemon({
      agentId: "test-agent",
      configPath,
      statePath: testDir,
    });
    spawnedPids.push(r1.pid);

    await waitForEndpoint(r1.socketPath);

    process.kill(r1.pid, "SIGKILL");
    await new Promise((r) => setTimeout(r, 500));

    const r2 = await spawnDaemon({
      agentId: "test-agent",
      configPath,
      statePath: testDir,
    });
    spawnedPids.push(r2.pid);

    await waitForEndpoint(r2.socketPath);

    expect(pidManager.isProcessRunning(r2.pid)).toBe(true);
  });
});
