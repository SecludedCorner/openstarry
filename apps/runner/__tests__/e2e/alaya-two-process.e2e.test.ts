/**
 * Distributed alaya two-process e2e — the Tenet #6 proof (TENET-2026-06-11).
 *
 * Spawns TWO REAL agent daemon processes (the real daemon-entry, not the
 * mock) sharing a daemon-distributed cluster HMAC key, and moves a seed
 * (bija) across the OS process boundary:
 *
 *   driver → A: alaya.plant (signs with A's cluster-key copy)
 *   driver → A: alaya.propagate(["agent-b"]) → IpcRemotePeer serializes the
 *     signed seed over B's named pipe → B's daemon alaya.acceptSeed →
 *     DistributedAlayaImpl.acceptRemote → B INDEPENDENTLY re-verifies the
 *     HMAC with its own key copy → store accept + vector-clock merge
 *   driver → B: alaya.query → the seed is there, agent-a ownership intact.
 *
 * Includes the NEGATIVE proof (wrong cluster key on B → seed rejected,
 * store stays empty) so the verification is demonstrably genuine rather
 * than tautological, and the fail-closed proof (plugin absent → RPC error).
 *
 * Honest scope (do not overclaim): cross-process on ONE host (named pipe /
 * UDS), trusted-parent key distribution via env-at-spawn, no replay nonce
 * (ISeed is FROZEN without one). exchangeSeeds/snapshot remain in-process.
 *
 * Prerequisite: `pnpm build` (drives dist/daemon/daemon-entry.js + built
 * sibling plugins, same assumption as cli.e2e).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnDaemon, setDaemonEntryOverride } from "../../src/daemon/launcher.js";
import { pidManager } from "../../src/daemon/pid-manager.js";
import { IPCClientImpl } from "../../src/daemon/ipc-client.js";
import { waitForEndpoint, getDefaultSocketPath } from "../../src/daemon/platform.js";

const REAL_DAEMON_ENTRY = resolve(import.meta.dirname, "../../dist/daemon/daemon-entry.js");

interface SeedShape {
  seedId: string;
  agentId: string;
  skandha: string;
  content: unknown;
  visibility: string;
  createdAt: number;
  updatedAt: number;
  signature?: string;
}

function makeSeed(agentId: string): SeedShape {
  const now = Date.now();
  return {
    seedId: `bija-${Math.random().toString(36).slice(2, 10)}`,
    agentId,
    skandha: "vijnana",
    content: { memo: "seed crossing the process boundary", born: now },
    visibility: "group",
    createdAt: now,
    updatedAt: now,
  };
}

function writeAgentConfig(dir: string, agentId: string, opts: {
  withAlaya: boolean;
  peers?: Array<{ agentId: string; socketPath: string }>;
}): string {
  const plugins: Array<Record<string, unknown>> = [
    { name: "@openstarry-plugin/context-sliding-window" },
    { name: "@openstarry-plugin/standard-function-fs" },
    { name: "@openstarry-plugin/guide-character-init" },
  ];
  if (opts.withAlaya) {
    plugins.push({
      name: "@openstarry-plugin/distributed-alaya",
      // agentId + hmacKeyHex are daemon-injected (TENET-2026-06-11);
      // only peers need explicit config.
      config: opts.peers ? { agentId, peers: opts.peers } : { agentId },
    });
  }
  const configPath = join(dir, `${agentId}.json`);
  writeFileSync(configPath, JSON.stringify({
    identity: { id: agentId, name: agentId, description: "alaya e2e", version: "0.1.0" },
    cognition: { provider: "test", model: "test", temperature: 0.7, maxTokens: 1000, maxToolRounds: 3 },
    capabilities: { tools: ["fs.read"], allowedPaths: [dir] },
    policy: { maxConcurrentTools: 1, toolTimeout: 10000 },
    memory: { slidingWindowSize: 5 },
    plugins,
    guide: "default-guide",
  }, null, 2), "utf-8");
  return configPath;
}

let testDir: string;
const spawnedPids: number[] = [];
const clients: IPCClientImpl[] = [];

beforeAll(() => {
  setDaemonEntryOverride(REAL_DAEMON_ENTRY);
});

afterAll(() => {
  setDaemonEntryOverride(null);
});

afterEach(async () => {
  for (const c of clients.splice(0)) {
    try { c.close(); } catch { /* ignore */ }
  }
  for (const pid of spawnedPids.splice(0)) {
    try {
      if (pidManager.isProcessRunning(pid)) process.kill(pid, "SIGKILL");
    } catch { /* ignore */ }
  }
  await new Promise((r) => setTimeout(r, 300));
  if (testDir && existsSync(testDir)) {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* best-effort on win32 */ }
  }
});

async function bootDaemon(agentId: string, configPath: string, statePath: string, keyHex: string) {
  const result = await spawnDaemon({
    agentId,
    configPath,
    statePath,
    env: { OPENSTARRY_HMAC_KEY: keyHex },
  });
  spawnedPids.push(result.pid);
  await waitForEndpoint(result.socketPath, 15_000);
  const client = new IPCClientImpl({ socketPath: result.socketPath, timeoutMs: 10_000 });
  await client.connect();
  clients.push(client);
  return { result, client };
}

function freshDir(tag: string): string {
  const dir = join(tmpdir(), `alaya-e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("Tenet #6 — alaya seed propagation across OS process boundaries (N=2, one host)", () => {
  it("plant on A → propagate → B receives, INDEPENDENTLY verifies, and serves the seed", async () => {
    testDir = freshDir("shared");
    const clusterKey = randomBytes(32).toString("hex");

    // B first (A's peer config needs B's socket path — deterministic, but
    // taking it from the spawn result is exact).
    const stateB = join(testDir, "state-b");
    mkdirSync(stateB, { recursive: true });
    const cfgB = writeAgentConfig(testDir, "agent-b", { withAlaya: true });
    const b = await bootDaemon("agent-b", cfgB, stateB, clusterKey);

    const stateA = join(testDir, "state-a");
    mkdirSync(stateA, { recursive: true });
    const cfgA = writeAgentConfig(testDir, "agent-a", {
      withAlaya: true,
      peers: [{ agentId: "agent-b", socketPath: b.result.socketPath }],
    });
    const a = await bootDaemon("agent-a", cfgA, stateA, clusterKey);

    // Sanity: socket path derivation matches the launcher's
    expect(b.result.socketPath).toBe(getDefaultSocketPath("agent-b", stateB));

    const seed = makeSeed("agent-a");
    const planted = await a.client.call("alaya.plant", { seed }) as { planted: boolean };
    expect(planted.planted).toBe(true);

    await a.client.call("alaya.propagate", { seedId: seed.seedId, targets: ["agent-b"] });

    // Poll B for the seed (propagation is fire-and-forget on A's side)
    const deadline = Date.now() + 8_000;
    let received: SeedShape[] = [];
    while (Date.now() < deadline) {
      const res = await b.client.call("alaya.query", { filter: {} }) as { seeds: SeedShape[] };
      received = res.seeds;
      if (received.length > 0) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    expect(received.length).toBe(1);
    expect(received[0].seedId).toBe(seed.seedId);
    expect(received[0].agentId).toBe("agent-a");           // ownership preserved across the boundary
    expect(typeof received[0].signature).toBe("string");    // arrived signed
    expect((received[0].signature as string).length).toBeGreaterThan(0);
  }, 60_000);

  it("NEGATIVE: B with a DIFFERENT cluster key rejects the seed (verification is genuine)", async () => {
    testDir = freshDir("wrongkey");

    const stateB = join(testDir, "state-b");
    mkdirSync(stateB, { recursive: true });
    const cfgB = writeAgentConfig(testDir, "agent-b", { withAlaya: true });
    const b = await bootDaemon("agent-b", cfgB, stateB, randomBytes(32).toString("hex"));

    const stateA = join(testDir, "state-a");
    mkdirSync(stateA, { recursive: true });
    const cfgA = writeAgentConfig(testDir, "agent-a", {
      withAlaya: true,
      peers: [{ agentId: "agent-b", socketPath: b.result.socketPath }],
    });
    const a = await bootDaemon("agent-a", cfgA, stateA, randomBytes(32).toString("hex"));

    const seed = makeSeed("agent-a");
    await a.client.call("alaya.plant", { seed });
    await a.client.call("alaya.propagate", { seedId: seed.seedId, targets: ["agent-b"] });

    // Give the wire a moment, then assert B's store stayed EMPTY and both
    // daemons survived (fail-closed swallow on A, fail-closed reject on B).
    await new Promise((r) => setTimeout(r, 1_500));
    const res = await b.client.call("alaya.query", { filter: {} }) as { seeds: SeedShape[] };
    expect(res.seeds).toEqual([]);
    expect((await a.client.call("agent.ping") as { pong: boolean }).pong).toBe(true);
    expect((await b.client.call("agent.ping") as { pong: boolean }).pong).toBe(true);

    // Direct injection without a valid signature must also be rejected.
    await expect(
      b.client.call("alaya.acceptSeed", { seed: { ...seed, signature: "deadbeef" }, vectorClock: { "agent-a": 1 } }),
    ).rejects.toThrow();
  }, 60_000);

  it("fail-closed: alaya.* RPC errors cleanly when the plugin is not loaded", async () => {
    testDir = freshDir("absent");
    const stateC = join(testDir, "state-c");
    mkdirSync(stateC, { recursive: true });
    const cfgC = writeAgentConfig(testDir, "agent-c", { withAlaya: false });
    const c = await bootDaemon("agent-c", cfgC, stateC, randomBytes(32).toString("hex"));

    // Fail-closed semantics: the call must REJECT and the daemon must SURVIVE.
    // (The IPC client's error wrapper is lossy about the message text — the
    // "not loaded" detail is asserted at the unit level; here we assert the
    // behavioral contract.)
    let rejected = false;
    try {
      await c.client.call("alaya.acceptSeed", { seed: makeSeed("agent-x"), vectorClock: {} });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    expect((await c.client.call("agent.ping") as { pong: boolean }).pong).toBe(true);
  }, 60_000);
});
