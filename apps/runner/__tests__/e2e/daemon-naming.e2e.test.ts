/**
 * Daemon naming e2e (Fractal Society Phase 1 / Spec Addendum A) — drives the
 * REAL daemon-entry and proves, across real processes:
 *   1. spawnChild WITHOUT an agentId → daemon auto-generates a unique
 *      `<parentId>-<generation>` id; the process tree carries name + generation.
 *   2. spawnChild WITH a human `name` → the tree surfaces the name.
 *   3. spawnChild with a DUPLICATE explicit id → rejected fail-closed (the prior
 *      silent-overwrite bug is fixed).
 * Prerequisite: pnpm build (reads dist/daemon/daemon-entry.js).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnDaemon, setDaemonEntryOverride } from "../../src/daemon/launcher.js";
import { pidManager } from "../../src/daemon/pid-manager.js";
import { IPCClientImpl } from "../../src/daemon/ipc-client.js";
import { waitForEndpoint } from "../../src/daemon/platform.js";

const REAL_DAEMON_ENTRY = resolve(import.meta.dirname, "../../dist/daemon/daemon-entry.js");

interface RegistryEntryShape {
  agentId: string;
  pid: number;
  status: string;
  parentAgentId?: string;
  childAgentIds: string[];
  name?: string;
  generation?: number;
}
interface TreeNodeShape { entry: RegistryEntryShape; children: TreeNodeShape[] }

function writeConfig(dir: string, agentId: string): string {
  const configPath = join(dir, `${agentId}.json`);
  writeFileSync(configPath, JSON.stringify({
    identity: { id: agentId, name: agentId, description: "naming e2e", version: "0.1.0" },
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
// Unique parent id per run so the persisted generation counter starts fresh.
const PARENT = `nm-${Date.now()}`;

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

async function bootParent() {
  testDir = join(tmpdir(), `naming-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(testDir, { recursive: true });
  const statePath = join(testDir, "state-parent");
  mkdirSync(statePath, { recursive: true });
  const configPath = writeConfig(testDir, PARENT);
  const result = await spawnDaemon({ agentId: PARENT, configPath, statePath });
  spawnedPids.push(result.pid);
  await waitForEndpoint(result.socketPath, 15_000);
  const client = new IPCClientImpl({ socketPath: result.socketPath, timeoutMs: 10_000 });
  await client.connect();
  clients.push(client);
  return client;
}

describe("Fractal Society Phase 1 — daemon naming (real daemon)", () => {
  it("auto-generates a unique id + generation when agentId is omitted; name surfaces in the tree", async () => {
    const client = await bootParent();

    // (1) spawn WITHOUT agentId, WITH a human name
    const childCfg = writeConfig(testDir, "kid"); // config file name independent of agentId
    const childState = join(testDir, "state-kid");
    mkdirSync(childState, { recursive: true });
    const r1 = await client.call("agent.spawnChild", {
      parentId: PARENT,
      childConfig: { name: "first-worker", configPath: childCfg, statePath: childState },
    }) as { pid: number; agentId: string };
    spawnedPids.push(r1.pid);

    // auto-id shape: <parent>-<n>
    expect(r1.agentId).toMatch(new RegExp(`^${PARENT}-\\d+$`));

    const tree = await client.call("agent.processTree") as TreeNodeShape[];
    const root = tree.find((n) => n.entry.agentId === PARENT)!;
    const kid = root.children.find((c) => c.entry.agentId === r1.agentId)!;
    expect(kid).toBeDefined();
    expect(kid.entry.name).toBe("first-worker");
    expect(typeof kid.entry.generation).toBe("number");
    expect(kid.entry.generation).toBeGreaterThanOrEqual(1);

    // (2) a second auto-id child gets a strictly greater generation (per-parent monotonic)
    const childCfg2 = writeConfig(testDir, "kid2");
    const childState2 = join(testDir, "state-kid2");
    mkdirSync(childState2, { recursive: true });
    const r2 = await client.call("agent.spawnChild", {
      parentId: PARENT,
      childConfig: { configPath: childCfg2, statePath: childState2 },
    }) as { pid: number; agentId: string };
    spawnedPids.push(r2.pid);

    const tree2 = await client.call("agent.processTree") as TreeNodeShape[];
    const root2 = tree2.find((n) => n.entry.agentId === PARENT)!;
    const k1 = root2.children.find((c) => c.entry.agentId === r1.agentId)!;
    const k2 = root2.children.find((c) => c.entry.agentId === r2.agentId)!;
    expect(k2.entry.generation!).toBeGreaterThan(k1.entry.generation!);
    // r2 had no name → defaults to its (auto) id
    expect(k2.entry.name).toBe(r2.agentId);
  }, 45_000);

  it("rejects a duplicate explicit agentId fail-closed (no silent overwrite)", async () => {
    const client = await bootParent();
    const cfg = writeConfig(testDir, "dupkid");
    const st = join(testDir, "state-dup");
    mkdirSync(st, { recursive: true });

    const r1 = await client.call("agent.spawnChild", {
      parentId: PARENT,
      childConfig: { agentId: "dup-explicit", configPath: cfg, statePath: st },
    }) as { pid: number; agentId: string };
    spawnedPids.push(r1.pid);
    expect(r1.agentId).toBe("dup-explicit");

    // second spawn with the SAME id must be rejected, not silently overwrite
    let rejected = false;
    try {
      await client.call("agent.spawnChild", {
        parentId: PARENT,
        childConfig: { agentId: "dup-explicit", configPath: cfg, statePath: st },
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);

    // the original entry is intact (still exactly one "dup-explicit" in the tree)
    const tree = await client.call("agent.processTree") as TreeNodeShape[];
    const root = tree.find((n) => n.entry.agentId === PARENT)!;
    const dups = root.children.filter((c) => c.entry.agentId === "dup-explicit");
    expect(dups.length).toBe(1);
    expect(dups[0].entry.pid).toBe(r1.pid);
  }, 45_000);
});
