/**
 * Fork / branch e2e — Fractal Society Phase 2 (Spec Addendum B, ratified 2026-06-27).
 *
 * A parent's session snapshot is the ONLY thing a forked child inherits (D4-a);
 * capabilities stay child ⊆ parent (the spawn lattice is NOT bypassed, D4-b);
 * memory/alaya are NOT inherited (D4-c). branch = N forks off the SAME snapshot
 * (shared forkOrigin). merge/select = honest future.
 *
 * Proof: seed a parent session on disk (the persistence store the daemon reads),
 * fork → the child's OWN session store now carries the parent's messages (via the
 * child daemon's agent.list-sessions); capability denial still bites; branch makes
 * N children sharing one forkOrigin.
 *
 * Sessions live under the fixed OPENSTARRY_HOME/sessions (homedir) — the test uses
 * unique agentIds and cleans up its own session subdirs.
 *
 * Prerequisite: `pnpm build` (real dist/daemon/daemon-entry.js).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import type { ISession, Message } from "@openstarry/sdk";
import { spawnDaemon, setDaemonEntryOverride } from "../../src/daemon/launcher.js";
import { pidManager } from "../../src/daemon/pid-manager.js";
import { IPCClientImpl } from "../../src/daemon/ipc-client.js";
import { waitForEndpoint, getDefaultSocketPath } from "../../src/daemon/platform.js";
import { FileSessionPersistence } from "../../src/daemon/session-persistence.js";
import { SESSIONS_DIR } from "../../src/bootstrap.js";

const REAL_DAEMON_ENTRY = resolve(import.meta.dirname, "../../dist/daemon/daemon-entry.js");

function writeConfig(dir: string, agentId: string): string {
  const configPath = join(dir, `${agentId}.json`);
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        identity: { id: agentId, name: agentId, description: "fork e2e", version: "0.1.0" },
        cognition: { provider: "test", model: "test", temperature: 0.7, maxTokens: 1000, maxToolRounds: 3 },
        capabilities: { tools: ["fs.read"], allowedPaths: [dir] },
        policy: { maxConcurrentTools: 1, toolTimeout: 10000 },
        memory: { slidingWindowSize: 5 },
        plugins: [
          { name: "@openstarry-plugin/context-sliding-window" },
          { name: "@openstarry-plugin/standard-function-fs" },
          { name: "@openstarry-plugin/guide-character-init" },
        ],
        guide: "default-guide",
      },
      null,
      2,
    ),
    "utf-8",
  );
  return configPath;
}

function msg(role: Message["role"], text: string): Message {
  return {
    id: `m-${Math.random().toString(36).slice(2, 10)}`,
    role,
    content: [{ type: "text", text }],
    createdAt: 1_700_000_000_000,
  };
}

let testDir: string;
const spawnedPids: number[] = [];
const clients: IPCClientImpl[] = [];
const sessionAgentIds: string[] = []; // SESSIONS_DIR subdirs to clean up

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
  for (const id of sessionAgentIds.splice(0)) {
    try { rmSync(join(SESSIONS_DIR, id), { recursive: true, force: true }); } catch { /* ignore */ }
  }
  if (testDir && existsSync(testDir)) {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* best-effort on win32 */ }
  }
});

/** Seed a session on disk (the store the daemon reads) with `messages`. */
async function seedSession(agentId: string, sessionId: string, messages: Message[]): Promise<void> {
  sessionAgentIds.push(agentId);
  const persistence = new FileSessionPersistence(SESSIONS_DIR);
  const session: ISession = { id: sessionId, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, metadata: {} };
  await persistence.saveNow(agentId, session, messages);
}

async function connectDaemon(agentId: string, statePath: string): Promise<IPCClientImpl> {
  const socketPath = getDefaultSocketPath(agentId, statePath);
  await waitForEndpoint(socketPath, 15_000);
  const client = new IPCClientImpl({ socketPath, timeoutMs: 10_000 });
  await client.connect();
  clients.push(client);
  return client;
}

describe("Fractal Society Phase 2 — fork / branch (Spec Addendum B)", () => {
  it("fork: the child inherits the parent's session snapshot (and only that)", async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const parentId = `fork-parent-${tag}`;
    const childId = `fork-child-${tag}`;
    testDir = join(tmpdir(), `fork-e2e-${Date.now()}-${tag}`);
    mkdirSync(testDir, { recursive: true });
    const statePath = join(testDir, "state");
    mkdirSync(statePath, { recursive: true });
    const childState = join(testDir, "state-child");
    mkdirSync(childState, { recursive: true });
    sessionAgentIds.push(childId); // fork writes the child's session store

    // A parent with a 3-message conversation already persisted.
    const sessionId = "sess-parent";
    await seedSession(parentId, sessionId, [
      msg("user", "remember the secret code is 1234"),
      msg("assistant", "noted: 1234"),
      msg("user", "what was the code?"),
    ]);

    const parentCfg = writeConfig(testDir, parentId);
    const parent = await spawnDaemon({ agentId: parentId, configPath: parentCfg, statePath });
    spawnedPids.push(parent.pid);
    const client = await connectDaemon(parentId, statePath);

    // Fork a child from the parent's session.
    const childCfg = writeConfig(testDir, childId);
    const forked = (await client.call("agent.fork", {
      parentId,
      parentSessionId: sessionId,
      childConfig: { agentId: childId, configPath: childCfg, statePath: childState },
    })) as { childAgentId: string; pid: number; forkOrigin: string; sessionId: string; messageCount: number };

    expect(forked.childAgentId).toBe(childId);
    expect(forked.messageCount).toBe(3);
    expect(forked.forkOrigin).toBe(`${parentId}:${sessionId}`);
    expect(pidManager.isProcessRunning(forked.pid)).toBe(true);
    spawnedPids.push(forked.pid);

    // The CHILD daemon's own session store now carries the parent snapshot.
    const childClient = await connectDaemon(childId, childState);
    const childSessions = (await childClient.call("agent.list-sessions", {})) as Array<{
      id: string;
      messageCount: number;
    }>;
    const inherited = childSessions.find((s) => s.id === sessionId);
    expect(inherited).toBeDefined();
    expect(inherited!.messageCount).toBe(3); // the parent's conversation crossed over
  }, 60_000);

  it("fork: capability lattice is NOT bypassed — an out-of-scope child config is denied", async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const parentId = `fork-parent-${tag}`;
    testDir = join(tmpdir(), `fork-e2e2-${Date.now()}-${tag}`);
    mkdirSync(testDir, { recursive: true });
    const statePath = join(testDir, "state");
    mkdirSync(statePath, { recursive: true });

    const sessionId = "sess-parent";
    await seedSession(parentId, sessionId, [msg("user", "hi")]);

    const parentCfg = writeConfig(testDir, parentId);
    const parent = await spawnDaemon({ agentId: parentId, configPath: parentCfg, statePath });
    spawnedPids.push(parent.pid);
    const client = await connectDaemon(parentId, statePath);

    // A child config OUTSIDE the parent's scope must be rejected (SEC-003), even via fork.
    const outsideDir = join(tmpdir(), `fork-outside-${Date.now()}-${tag}`);
    mkdirSync(outsideDir, { recursive: true });
    const outsideCfg = writeConfig(outsideDir, "evil-fork");
    let denied = false;
    try {
      await client.call("agent.fork", {
        parentId,
        parentSessionId: sessionId,
        childConfig: { agentId: "evil-fork", configPath: outsideCfg, statePath: outsideDir },
      });
    } catch {
      denied = true;
    }
    expect(denied).toBe(true);
    try { rmSync(outsideDir, { recursive: true, force: true }); } catch { /* ignore */ }
    expect(((await client.call("agent.ping")) as { pong: boolean }).pong).toBe(true);
  }, 60_000);

  it("branch: N children share one snapshot + one forkOrigin", async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const parentId = `fork-parent-${tag}`;
    const b1 = `branch1-${tag}`;
    const b2 = `branch2-${tag}`;
    testDir = join(tmpdir(), `fork-e2e3-${Date.now()}-${tag}`);
    mkdirSync(testDir, { recursive: true });
    const statePath = join(testDir, "state");
    mkdirSync(statePath, { recursive: true });
    const b1State = join(testDir, "s1"); mkdirSync(b1State, { recursive: true });
    const b2State = join(testDir, "s2"); mkdirSync(b2State, { recursive: true });
    sessionAgentIds.push(b1, b2);

    const sessionId = "sess-parent";
    await seedSession(parentId, sessionId, [msg("user", "explore options"), msg("assistant", "ok")]);

    const parentCfg = writeConfig(testDir, parentId);
    const parent = await spawnDaemon({ agentId: parentId, configPath: parentCfg, statePath });
    spawnedPids.push(parent.pid);
    const client = await connectDaemon(parentId, statePath);

    const res = (await client.call("agent.branch", {
      parentId,
      parentSessionId: sessionId,
      children: [
        { agentId: b1, configPath: writeConfig(testDir, b1), statePath: b1State },
        { agentId: b2, configPath: writeConfig(testDir, b2), statePath: b2State },
      ],
    })) as { results: Array<{ childAgentId: string; pid: number; forkOrigin: string; messageCount: number }> };

    expect(res.results.length).toBe(2);
    for (const r of res.results) {
      spawnedPids.push(r.pid);
      expect(r.forkOrigin).toBe(`${parentId}:${sessionId}`); // shared branch group
      expect(r.messageCount).toBe(2);
    }
    expect(res.results[0].childAgentId).toBe(b1);
    expect(res.results[1].childAgentId).toBe(b2);

    // One branch child's store carries the snapshot.
    const b1Client = await connectDaemon(b1, b1State);
    const b1Sessions = (await b1Client.call("agent.list-sessions", {})) as Array<{ id: string; messageCount: number }>;
    expect(b1Sessions.find((s) => s.id === sessionId)?.messageCount).toBe(2);
  }, 60_000);
});
