/**
 * Daemon process-tree attestation e2e (GAP-2026-06-11, T3b — Tenet #10 Phase 2).
 *
 * Drives the REAL daemon-entry (not the mock): until the T3b fixes, the root
 * agent was never registered in agentRegistry — `agent.processTree` returned
 * [] on every real daemon and `agent.childAgents` always came back empty —
 * and parent shutdown never reaped spawned children (gracefulStopAgent had
 * zero call sites), orphaning them forever.
 *
 * Proven here:
 *   1. root self-registration → processTree returns a real tree;
 *   2. agent.spawnChild really spawns a child daemon process, the tree shows
 *      parent→child, childAgents lists it;
 *   3. SEC-003: a child config outside the parent's scope is DENIED;
 *   4. parent shutdown cascades SIGTERM to the child (no orphan).
 *
 * Honesty boundary (unchanged from Phase 1): the daemon-spawned child is NOT
 * the delegation target — parent mcp-client connects at boot, before any
 * spawnChild; cognition delegation is proven separately in
 * fractal-composition.e2e.test.ts. Prerequisite: pnpm build.
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
}
interface TreeNodeShape { entry: RegistryEntryShape; children: TreeNodeShape[] }

function writeConfig(dir: string, agentId: string): string {
  const configPath = join(dir, `${agentId}.json`);
  writeFileSync(configPath, JSON.stringify({
    identity: { id: agentId, name: agentId, description: "tree e2e", version: "0.1.0" },
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

async function bootParent() {
  testDir = join(tmpdir(), `tree-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(testDir, { recursive: true });
  const statePath = join(testDir, "state-parent");
  mkdirSync(statePath, { recursive: true });
  const configPath = writeConfig(testDir, "tree-parent");
  const result = await spawnDaemon({ agentId: "tree-parent", configPath, statePath });
  spawnedPids.push(result.pid);
  await waitForEndpoint(result.socketPath, 15_000);
  const client = new IPCClientImpl({ socketPath: result.socketPath, timeoutMs: 10_000 });
  await client.connect();
  clients.push(client);
  return { result, client };
}

describe("Tenet #10 Phase 2 — daemon process tree is real (GAP-2026-06-11 T3b)", () => {
  it("root self-registers: processTree returns the root node (was [] before the fix)", async () => {
    const { client } = await bootParent();
    const tree = await client.call("agent.processTree") as TreeNodeShape[];
    expect(tree.length).toBe(1);
    expect(tree[0].entry.agentId).toBe("tree-parent");
    expect(tree[0].entry.status).toBe("running");
    expect(tree[0].children).toEqual([]);
  }, 30_000);

  it("spawnChild: real child process + tree edge + childAgents + SEC-003 denial", async () => {
    const { client } = await bootParent();

    // Child config in the SAME directory as the parent's (SEC-003 scope).
    const childConfigPath = writeConfig(testDir, "tree-child");
    const childState = join(testDir, "state-child");
    mkdirSync(childState, { recursive: true });

    const spawnResult = await client.call("agent.spawnChild", {
      parentId: "tree-parent",
      childConfig: { agentId: "tree-child", configPath: childConfigPath, statePath: childState },
    }) as { pid: number };
    spawnedPids.push(spawnResult.pid);
    expect(pidManager.isProcessRunning(spawnResult.pid)).toBe(true);

    // Tree shows parent → child (only true after root registration).
    const tree = await client.call("agent.processTree") as TreeNodeShape[];
    expect(tree.length).toBe(1);
    expect(tree[0].entry.agentId).toBe("tree-parent");
    expect(tree[0].children.length).toBe(1);
    expect(tree[0].children[0].entry.agentId).toBe("tree-child");
    expect(tree[0].children[0].entry.parentAgentId).toBe("tree-parent");

    const children = await client.call("agent.childAgents", { parentId: "tree-parent" }) as RegistryEntryShape[];
    expect(children.length).toBe(1);
    expect(children[0].agentId).toBe("tree-child");

    // SEC-003: a config OUTSIDE the parent's scope must be denied fail-closed.
    const outsideDir = join(tmpdir(), `tree-outside-${Date.now()}`);
    mkdirSync(outsideDir, { recursive: true });
    const outsideConfig = writeConfig(outsideDir, "evil-child");
    let denied = false;
    try {
      await client.call("agent.spawnChild", {
        parentId: "tree-parent",
        childConfig: { agentId: "evil-child", configPath: outsideConfig, statePath: outsideDir },
      });
    } catch {
      denied = true;
    }
    expect(denied).toBe(true);
    try { rmSync(outsideDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }, 45_000);

  it("orphan reap: parent shutdown cascades SIGTERM to the spawned child", async () => {
    const { client } = await bootParent();

    const childConfigPath = writeConfig(testDir, "tree-child2");
    const childState = join(testDir, "state-child2");
    mkdirSync(childState, { recursive: true });
    const spawnResult = await client.call("agent.spawnChild", {
      parentId: "tree-parent",
      childConfig: { agentId: "tree-child2", configPath: childConfigPath, statePath: childState },
    }) as { pid: number };
    spawnedPids.push(spawnResult.pid);
    expect(pidManager.isProcessRunning(spawnResult.pid)).toBe(true);

    // Graceful parent stop → cascade must reach the child.
    await client.call("agent.stop");

    const deadline = Date.now() + 12_000;
    while (pidManager.isProcessRunning(spawnResult.pid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(pidManager.isProcessRunning(spawnResult.pid)).toBe(false);
  }, 45_000);
});
