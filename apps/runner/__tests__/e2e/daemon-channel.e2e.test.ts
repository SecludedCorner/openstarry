/**
 * ICommChannel two-process e2e — Doc 53 alignment.
 *
 * Closes the audited gap: ICommChannel was a frozen contract whose registry was
 * populated by the plugin loader but NEVER consumed; send()/onMessage() did real
 * work nowhere. This proves a real ICommChannel (the @openstarry-plugin/comm-channel-p2p
 * plugin) is now LIVE over the cross-daemon transport:
 *
 *   A: comm.channelSend(channel='p2p', target=agent-b)  -> channel.send()
 *      -> DAEMON_COMM transport (validateOutbound + HMAC) -> B daemon comm.deliver
 *      -> daemon dispatches to registered channels -> B's p2p channel.deliverInbound
 *      -> onMessage handlers fire + recorded
 *   B: comm.channelReceived(channel='p2p') -> the message is there.
 *
 * Also asserts the daemon CONNECTED the channel at startup (registry consumed) and
 * the capability lattice still bites (send to a disallowed target rejected).
 *
 * Prerequisite: `pnpm build` (real dist/daemon/daemon-entry.js + built plugin).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { CommMessage } from "@openstarry/sdk";
import { spawnDaemon, setDaemonEntryOverride } from "../../src/daemon/launcher.js";
import { pidManager } from "../../src/daemon/pid-manager.js";
import { IPCClientImpl } from "../../src/daemon/ipc-client.js";
import { waitForEndpoint, getDefaultSocketPath } from "../../src/daemon/platform.js";

const REAL_DAEMON_ENTRY = resolve(import.meta.dirname, "../../dist/daemon/daemon-entry.js");

function writeChannelConfig(dir: string, agentId: string, communication: { canSendTo?: string[]; canReceiveFrom?: string[] }): string {
  const configPath = join(dir, `${agentId}.json`);
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        identity: { id: agentId, name: agentId, description: "channel e2e", version: "0.1.0" },
        cognition: { provider: "test", model: "test", temperature: 0.7, maxTokens: 1000, maxToolRounds: 3 },
        capabilities: { tools: ["fs.read"], allowedPaths: [dir] },
        policy: { maxConcurrentTools: 1, toolTimeout: 10000 },
        memory: { slidingWindowSize: 5 },
        communication,
        plugins: [
          { name: "@openstarry-plugin/context-sliding-window" },
          { name: "@openstarry-plugin/standard-function-fs" },
          { name: "@openstarry-plugin/guide-character-init" },
          { name: "@openstarry-plugin/comm-channel-p2p" },
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

async function bootDaemon(agentId: string, configPath: string, statePath: string, keyHex: string) {
  const result = await spawnDaemon({ agentId, configPath, statePath, env: { OPENSTARRY_HMAC_KEY: keyHex } });
  spawnedPids.push(result.pid);
  await waitForEndpoint(result.socketPath, 15_000);
  const client = new IPCClientImpl({ socketPath: result.socketPath, timeoutMs: 10_000 });
  await client.connect();
  clients.push(client);
  return { result, client };
}

function freshDir(tag: string): string {
  const dir = join(tmpdir(), `chan-e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("Doc 53 — ICommChannel live over the real transport (comm-channel-p2p)", () => {
  it("the channel is registered + connected; send() reaches the peer's channel.onMessage", async () => {
    testDir = freshDir("p2p");
    const stateDir = join(testDir, "state");
    mkdirSync(stateDir, { recursive: true });
    const clusterKey = randomBytes(32).toString("hex");

    const cfgB = writeChannelConfig(testDir, "agent-b", { canReceiveFrom: ["agent-a"] });
    const b = await bootDaemon("agent-b", cfgB, stateDir, clusterKey);
    const cfgA = writeChannelConfig(testDir, "agent-a", { canSendTo: ["agent-b"] });
    const a = await bootDaemon("agent-a", cfgA, stateDir, clusterKey);

    // The daemon consumed the registry at startup: the p2p channel exists + is connected.
    const list = (await a.client.call("comm.channelList", {})) as {
      channels: Array<{ name: string; capabilities: string[]; topology: string; status: string }>;
    };
    const p2p = list.channels.find((c) => c.name === "p2p");
    expect(p2p).toBeDefined();
    expect(p2p!.capabilities).toContain("messaging");
    expect(p2p!.topology).toBe("point-to-point");
    expect(p2p!.status).toBe("connected"); // daemon called channel.connect() at startup

    // A sends THROUGH the ICommChannel (not the raw service) -> real transport.
    const sent = (await a.client.call("comm.channelSend", {
      channel: "p2p",
      target: "agent-b",
      payload: { hi: "via-channel" },
    })) as { sent: boolean };
    expect(sent.sent).toBe(true);

    // B's p2p channel received it (daemon dispatched inbound -> channel.deliverInbound -> onMessage).
    const deadline = Date.now() + 8_000;
    let received: CommMessage[] = [];
    while (Date.now() < deadline) {
      const res = (await b.client.call("comm.channelReceived", { channel: "p2p" })) as { messages: CommMessage[] };
      received = res.messages;
      if (received.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(received.length).toBe(1);
    expect(received[0].source).toBe("agent-a");
    expect(received[0].payload).toEqual({ hi: "via-channel" });

    // Sanity: B's socket derivation matches (same-home).
    expect(b.result.socketPath).toBe(getDefaultSocketPath("agent-b", stateDir));
  }, 60_000);

  it("the capability lattice still bites: channel.send to a disallowed target is rejected", async () => {
    testDir = freshDir("cap");
    const stateDir = join(testDir, "state");
    mkdirSync(stateDir, { recursive: true });
    const clusterKey = randomBytes(32).toString("hex");

    const cfgA = writeChannelConfig(testDir, "agent-a", { canSendTo: ["agent-b"] });
    const a = await bootDaemon("agent-a", cfgA, stateDir, clusterKey);

    // agent-a may not send to agent-z -> validateOutbound denies, surfaced through the channel.
    await expect(
      a.client.call("comm.channelSend", { channel: "p2p", target: "agent-z", payload: "x" }),
    ).rejects.toThrow();
    expect(((await a.client.call("agent.ping")) as { pong: boolean }).pong).toBe(true);
  }, 60_000);
});
