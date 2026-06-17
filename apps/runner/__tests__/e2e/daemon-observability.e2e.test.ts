/**
 * Daemon observability e2e (⑦ Tech Spec 18 / Doc 46, v0.59.7-alpha).
 *
 * Drives the REAL daemon-entry with OPENSTARRY_LOG_PATH + OPENSTARRY_AUDIT set
 * and proves the wire-in actually fires in the live daemon process — not just
 * at the module level:
 *   1. lifecycle structured-log: daemon:started, agent:registered (root +
 *      child), agent:deregistered (shutdown cascade), daemon:shutdown;
 *   2. denial audit: an out-of-scope agent.spawnChild (SEC-003) is journaled
 *      as agent_request_denied / spawn_constraint.
 *
 * Buffers flush at graceful shutdown (obs.flush, structured-log 200 →
 * audit-sink 300) — both files are read AFTER the daemon exits. Prerequisite:
 * pnpm build (reads dist/daemon/daemon-entry.js).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnDaemon, setDaemonEntryOverride } from "../../src/daemon/launcher.js";
import { pidManager } from "../../src/daemon/pid-manager.js";
import { IPCClientImpl } from "../../src/daemon/ipc-client.js";
import { waitForEndpoint } from "../../src/daemon/platform.js";

const REAL_DAEMON_ENTRY = resolve(import.meta.dirname, "../../dist/daemon/daemon-entry.js");

function writeConfig(dir: string, agentId: string): string {
  const configPath = join(dir, `${agentId}.json`);
  writeFileSync(configPath, JSON.stringify({
    identity: { id: agentId, name: agentId, description: "obs e2e", version: "0.1.0" },
    cognition: { provider: "test", model: "test", temperature: 0.7, maxTokens: 1000, maxToolRounds: 3 },
    capabilities: { tools: ["fs.read"], allowedPaths: [dir] },
    policy: { maxConcurrentTools: 1, toolTimeout: 10000 },
    memory: { slidingWindowSize: 5 },
    communication: { gracePeriodMs: 500 },
    plugins: [
      { name: "@openstarry-plugin/context-sliding-window" },
      { name: "@openstarry-plugin/standard-function-fs" },
      { name: "@openstarry-plugin/guide-character-init" },
    ],
    guide: "default-guide",
  }, null, 2), "utf-8");
  return configPath;
}

let testDir: string;
const spawnedPids: number[] = [];
const clients: IPCClientImpl[] = [];

beforeAll(() => { setDaemonEntryOverride(REAL_DAEMON_ENTRY); });
afterAll(() => { setDaemonEntryOverride(null); });

afterEach(async () => {
  for (const c of clients.splice(0)) { try { c.close(); } catch { /* ignore */ } }
  for (const pid of spawnedPids.splice(0)) {
    try { if (pidManager.isProcessRunning(pid)) process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
  }
  await new Promise((r) => setTimeout(r, 300));
  if (testDir && existsSync(testDir)) {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

async function waitForExit(pid: number, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (pidManager.isProcessRunning(pid) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
}

function readEvents(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => (JSON.parse(l) as { event: string }).event);
}

describe("⑦ daemon observability — lifecycle log + denial audit (real daemon)", () => {
  it("journals lifecycle records and a spawn_constraint denial, flushed at shutdown", async () => {
    testDir = join(tmpdir(), `obs-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(testDir, { recursive: true });
    const statePath = join(testDir, "state-parent");
    mkdirSync(statePath, { recursive: true });
    const logPath = join(testDir, "structured.jsonl");
    const auditPath = join(testDir, "audit.jsonl");

    const configPath = writeConfig(testDir, "obs-parent");
    const result = await spawnDaemon({
      agentId: "obs-parent",
      configPath,
      statePath,
      env: {
        OPENSTARRY_LOG_PATH: logPath,
        OPENSTARRY_AUDIT: "1",
        AUDIT_SINK_PATH: auditPath,
      },
    });
    spawnedPids.push(result.pid);
    await waitForEndpoint(result.socketPath, 15_000);

    const client = new IPCClientImpl({ socketPath: result.socketPath, timeoutMs: 10_000 });
    await client.connect();
    clients.push(client);

    // Spawn a VALID child (in parent scope) → agent:registered(child).
    const childConfigPath = writeConfig(testDir, "obs-child");
    const childState = join(testDir, "state-child");
    mkdirSync(childState, { recursive: true });
    const spawnResult = await client.call("agent.spawnChild", {
      parentId: "obs-parent",
      childConfig: { agentId: "obs-child", configPath: childConfigPath, statePath: childState },
    }) as { pid: number };
    spawnedPids.push(spawnResult.pid);

    // Attempt an OUT-OF-SCOPE child (SEC-003) → spawn_constraint denial audit.
    const outsideDir = join(tmpdir(), `obs-outside-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(outsideDir, { recursive: true });
    const outsideConfig = writeConfig(outsideDir, "evil-child");
    let denied = false;
    try {
      await client.call("agent.spawnChild", {
        parentId: "obs-parent",
        childConfig: { agentId: "evil-child", configPath: outsideConfig, statePath: outsideDir },
      });
    } catch {
      denied = true;
    }
    expect(denied).toBe(true);
    try { rmSync(outsideDir, { recursive: true, force: true }); } catch { /* ignore */ }

    // Graceful stop → cascade (agent:deregistered) + daemon:shutdown + flush.
    await client.call("agent.stop");
    await waitForExit(result.pid, 15_000);
    expect(pidManager.isProcessRunning(result.pid)).toBe(false);

    // Give the detached process a moment to finish its final fs writes.
    await new Promise((r) => setTimeout(r, 500));

    // --- structured-log lifecycle ---
    const events = readEvents(logPath);
    expect(events).toContain("daemon:started");
    expect(events).toContain("agent:registered");   // root (+ child)
    expect(events).toContain("daemon:shutdown");
    // Both root and child registrations were logged.
    expect(events.filter((e) => e === "agent:registered").length).toBeGreaterThanOrEqual(2);
    // Cascade deregistration of the child.
    expect(events).toContain("agent:deregistered");

    // --- denial audit ---
    expect(existsSync(auditPath)).toBe(true);
    const auditRecords = readFileSync(auditPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { type: string; reason: string; agentId: string; detail?: string });
    const denial = auditRecords.find((r) => r.type === "agent_request_denied");
    expect(denial).toBeDefined();
    expect(denial!.reason).toBe("spawn_constraint");
    expect(denial!.agentId).toBe("obs-parent");
  }, 60_000);
});
