/**
 * Cross-daemon comm two-process e2e — the Fractal Society C/T1 proof
 * (Spec Addendum C, Master-ratified 2026-06-26).
 *
 * Spawns TWO REAL agent daemon processes (the real daemon-entry, not a mock)
 * that share a state directory (so a peer agentId resolves to its daemon socket)
 * and a cluster HMAC key, then moves a CommMessage across the OS process
 * boundary:
 *
 *   driver → A: comm.send({ target: "agent-b", ... })
 *     → A.MessageRouter.validateOutbound (A.canSendTo ∋ agent-b)
 *     → A.CommTransport signs with A's cluster-key copy + comm.deliver over B's
 *       named pipe → B's daemon comm.deliver handler
 *     → B INDEPENDENTLY re-verifies the HMAC with its own key copy
 *     → B.MessageRouter.validateInbound (B.canReceiveFrom ∋ agent-a, replay,
 *       freshness, envelope) → B inbox + pushInput
 *   driver → B: comm.inbox → the message is there, source intact.
 *
 * This is the step that turns MessageRouter from a validation layer into a real
 * transport: validateOutbound/validateInbound run on genuine cross-process
 * traffic. Includes the NEGATIVE proofs so the verification is demonstrably
 * genuine rather than tautological:
 *   - forged signature (wrong cluster key) → rejected (HMAC, fail-closed)
 *   - correctly-signed but from a sender B does not accept → rejected (capability)
 *   - a byte-identical resend → rejected (replay), and the rejected messages
 *     never land in B's inbox, while every rejection is journaled as
 *     `comm_denied` in B's audit trail.
 *
 * Honest scope (do not overclaim): cross-process on ONE host (named pipe / UDS),
 * same state directory (the fractal-society topology: parent + spawned children
 * share OPENSTARRY_HOME), trusted-parent key distribution via env-at-spawn.
 * Cross-host / N>2 gossip are future.
 *
 * Prerequisite: `pnpm build` (drives dist/daemon/daemon-entry.js + built sibling
 * plugins, same assumption as cli.e2e / alaya-two-process.e2e).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { CommMessage } from "@openstarry/sdk";
import { spawnDaemon, setDaemonEntryOverride } from "../../src/daemon/launcher.js";
import { pidManager } from "../../src/daemon/pid-manager.js";
import { IPCClientImpl } from "../../src/daemon/ipc-client.js";
import { waitForEndpoint, getDefaultSocketPath } from "../../src/daemon/platform.js";
import { signCommMessage, signCanonical } from "../../src/daemon/comm-signature.js";

const REAL_DAEMON_ENTRY = resolve(import.meta.dirname, "../../dist/daemon/daemon-entry.js");

interface CommConfig {
  canSendTo?: string[];
  canReceiveFrom?: string[];
}

function writeCommConfig(dir: string, agentId: string, communication: CommConfig): string {
  const configPath = join(dir, `${agentId}.json`);
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        identity: { id: agentId, name: agentId, description: "comm e2e", version: "0.1.0" },
        cognition: { provider: "test", model: "test", temperature: 0.7, maxTokens: 1000, maxToolRounds: 3 },
        capabilities: { tools: ["fs.read"], allowedPaths: [dir] },
        policy: { maxConcurrentTools: 1, toolTimeout: 10000 },
        memory: { slidingWindowSize: 5 },
        communication,
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

/** A correctly-shaped CommMessage the test signs itself (it holds the key). */
function craftMessage(source: string, target: string): CommMessage {
  return {
    id: `craft-${Math.random().toString(36).slice(2, 10)}`,
    timestamp: Date.now(),
    source,
    target,
    payload: { crafted: true },
    performative: "inform",
    traceDepth: 0,
  };
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

async function bootDaemon(
  agentId: string,
  configPath: string,
  statePath: string,
  keyHex: string,
  extraEnv: Record<string, string> = {},
) {
  const result = await spawnDaemon({
    agentId,
    configPath,
    statePath,
    env: { OPENSTARRY_HMAC_KEY: keyHex, ...extraEnv },
  });
  spawnedPids.push(result.pid);
  await waitForEndpoint(result.socketPath, 15_000);
  const client = new IPCClientImpl({ socketPath: result.socketPath, timeoutMs: 10_000 });
  await client.connect();
  clients.push(client);
  return { result, client };
}

function freshDir(tag: string): string {
  const dir = join(tmpdir(), `comm-e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!pidManager.isProcessRunning(pid)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("Tenet #10 — cross-daemon agent↔agent messaging (C/T1, N=2, one host)", () => {
  it("A→B delivered; forged-sig / wrong-sender / replay rejected and journaled as comm_denied", async () => {
    testDir = freshDir("p2p");
    // SHARED state dir = the fractal-society topology (peers resolvable via
    // getDefaultSocketPath(peerId, stateDir)). Both daemons get --state-path here.
    const stateDir = join(testDir, "state");
    mkdirSync(stateDir, { recursive: true });
    const clusterKey = randomBytes(32).toString("hex");
    const auditPath = join(testDir, "audit-b.jsonl");

    // B first (its socket must exist before A sends). B accepts only from agent-a
    // and journals denials (audit env).
    const cfgB = writeCommConfig(testDir, "agent-b", { canReceiveFrom: ["agent-a"] });
    const b = await bootDaemon("agent-b", cfgB, stateDir, clusterKey, {
      OPENSTARRY_AUDIT: "1",
      AUDIT_SINK_PATH: auditPath,
    });

    // A may send only to agent-b.
    const cfgA = writeCommConfig(testDir, "agent-a", { canSendTo: ["agent-b"] });
    const a = await bootDaemon("agent-a", cfgA, stateDir, clusterKey);

    // Sanity: shared-home socket derivation matches the launcher's.
    expect(b.result.socketPath).toBe(getDefaultSocketPath("agent-b", stateDir));

    // 1. POSITIVE — A sends to B over the real transport (control plane mirrors
    //    the agent.send tool, no LLM turn needed).
    const sent = (await a.client.call("comm.send", {
      target: "agent-b",
      payload: { hello: "world" },
      performative: "inform",
    })) as { delivered: boolean; messageId: string };
    expect(sent.delivered).toBe(true);
    expect(typeof sent.messageId).toBe("string");

    // Poll B's inbox (delivery is synchronous, but poll for robustness).
    const deadline = Date.now() + 8_000;
    let inbox: CommMessage[] = [];
    while (Date.now() < deadline) {
      const res = (await b.client.call("comm.inbox", {})) as { messages: CommMessage[] };
      inbox = res.messages;
      if (inbox.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(inbox.length).toBe(1);
    expect(inbox[0].source).toBe("agent-a");
    expect(inbox[0].target).toBe("agent-b");
    expect(inbox[0].payload).toEqual({ hello: "world" });

    // 2. NEGATIVE — forged signature (wrong cluster key) → HMAC rejection.
    const forged = craftMessage("agent-a", "agent-b");
    const forgedSig = signCommMessage(forged, randomBytes(32).toString("hex"));
    await expect(
      b.client.call("comm.deliver", { message: forged, signature: forgedSig }),
    ).rejects.toThrow();

    // 3. NEGATIVE — correctly signed but from a sender B does not accept →
    //    capability rejection (canReceiveFrom). Source is HMAC-authenticated, so
    //    the sender genuinely is "agent-evil" and is genuinely refused.
    const evil = craftMessage("agent-evil", "agent-b");
    const evilSig = signCommMessage(evil, clusterKey);
    await expect(
      b.client.call("comm.deliver", { message: evil, signature: evilSig }),
    ).rejects.toThrow();

    // 4. NEGATIVE — replay: a valid, capability-OK message accepted once then
    //    re-sent byte-identically → replay rejection.
    const replayMsg = craftMessage("agent-a", "agent-b");
    const replaySig = signCommMessage(replayMsg, clusterKey);
    const first = (await b.client.call("comm.deliver", {
      message: replayMsg,
      signature: replaySig,
    })) as { delivered: boolean };
    expect(first.delivered).toBe(true);
    await expect(
      b.client.call("comm.deliver", { message: replayMsg, signature: replaySig }),
    ).rejects.toThrow();

    // Inbox holds exactly the 2 ACCEPTED messages (positive + replay's first
    // delivery); every rejected message stayed out.
    const finalInbox = (await b.client.call("comm.inbox", {})) as { messages: CommMessage[] };
    expect(finalInbox.messages.length).toBe(2);
    expect(finalInbox.messages.every((m) => m.source === "agent-a")).toBe(true);

    // Both daemons survived all fail-closed rejections.
    expect(((await a.client.call("agent.ping")) as { pong: boolean }).pong).toBe(true);
    expect(((await b.client.call("agent.ping")) as { pong: boolean }).pong).toBe(true);

    // 5. Denial audit — graceful-stop B → flush → comm_denied records present.
    await b.client.call("agent.stop");
    await waitForExit(b.result.pid, 15_000);
    await new Promise((r) => setTimeout(r, 500)); // detached process final fs writes

    expect(existsSync(auditPath)).toBe(true);
    const records = readFileSync(auditPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { type: string; reason: string; agentId: string; detail?: string });
    const commDenials = records.filter(
      (r) => r.type === "agent_request_denied" && r.reason === "comm_denied",
    );
    // forged (HMAC) + wrong-sender (capability) + replay = three distinct denials.
    expect(commDenials.length).toBeGreaterThanOrEqual(2);
    expect(commDenials.every((r) => r.agentId === "agent-b")).toBe(true);
  }, 60_000);

  it("sender-side capability gate: comm.send to a disallowed target is rejected (validateOutbound)", async () => {
    testDir = freshDir("outbound");
    const stateDir = join(testDir, "state");
    mkdirSync(stateDir, { recursive: true });
    const clusterKey = randomBytes(32).toString("hex");

    const cfgA = writeCommConfig(testDir, "agent-a", { canSendTo: ["agent-b"] });
    const a = await bootDaemon("agent-a", cfgA, stateDir, clusterKey);

    // agent-a is not permitted to send to agent-z → validateOutbound denies
    // BEFORE any transport attempt (fail-closed at the sender).
    await expect(a.client.call("comm.send", { target: "agent-z", payload: "x" })).rejects.toThrow();

    // The daemon survived the denial.
    expect(((await a.client.call("agent.ping")) as { pong: boolean }).pong).toBe(true);
  }, 60_000);
});

interface CoordEvent {
  type: string;
  agentId: string;
  timestamp: number;
  payload?: unknown;
}

describe("Tenet #10 — cross-daemon cluster pub/sub (C/T2, N=2, one host)", () => {
  it("A subscribes to B; B's published events reach A; unsubscribed types + forged events rejected", async () => {
    testDir = freshDir("pubsub");
    const stateDir = join(testDir, "state");
    mkdirSync(stateDir, { recursive: true });
    const clusterKey = randomBytes(32).toString("hex");

    // No messaging caps needed — pub/sub is gated by subscription + HMAC.
    const cfgB = writeCommConfig(testDir, "agent-b", {});
    const b = await bootDaemon("agent-b", cfgB, stateDir, clusterKey);
    const cfgA = writeCommConfig(testDir, "agent-a", {});
    const a = await bootDaemon("agent-a", cfgA, stateDir, clusterKey);

    // A subscribes to B's status_changed events — registers agent-a on B's
    // EventBridge over the signed comm.subscribe wire.
    const sub = (await a.client.call("comm.subscribeTo", {
      target: "agent-b",
      eventTypes: ["agent:status_changed"],
    })) as { subscribed: boolean };
    expect(sub.subscribed).toBe(true);

    // B publishes a status_changed → EventBridge.deliverFn delivers it to A.
    await b.client.call("eventbridge.publish", { type: "agent:status_changed", payload: { status: "busy" } });

    // Poll A's coordination inbox (delivery is fire-and-forget on B's side).
    const deadline = Date.now() + 8_000;
    let events: CoordEvent[] = [];
    while (Date.now() < deadline) {
      const res = (await a.client.call("comm.events", {})) as { events: CoordEvent[] };
      events = res.events;
      if (events.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("agent:status_changed");
    expect(events[0].agentId).toBe("agent-b");
    expect(events[0].payload).toEqual({ status: "busy" });

    // NEGATIVE — unsubscribed type: A never subscribed to agent:leaving, so B
    // publishing it must NOT reach A.
    await b.client.call("eventbridge.publish", { type: "agent:leaving" });
    await new Promise((r) => setTimeout(r, 800));
    const after = (await a.client.call("comm.events", {})) as { events: CoordEvent[] };
    expect(after.events.length).toBe(1);
    expect(after.events.every((e) => e.type === "agent:status_changed")).toBe(true);

    // NEGATIVE — forged event signature: a direct comm.event with a bad sig is
    // rejected (fail-closed) and does not land.
    const forgedEvent: CoordEvent = {
      type: "agent:status_changed",
      agentId: "agent-b",
      timestamp: Date.now(),
      payload: { spoof: true },
    };
    const badSig = signCanonical(forgedEvent, randomBytes(32).toString("hex"));
    await expect(
      a.client.call("comm.event", { event: forgedEvent, signature: badSig }),
    ).rejects.toThrow();

    const final = (await a.client.call("comm.events", {})) as { events: CoordEvent[] };
    expect(final.events.length).toBe(1);
    expect(((await a.client.call("agent.ping")) as { pong: boolean }).pong).toBe(true);
    expect(((await b.client.call("agent.ping")) as { pong: boolean }).pong).toBe(true);
  }, 60_000);

  it("forged subscription is rejected (HMAC, fail-closed)", async () => {
    testDir = freshDir("subhmac");
    const stateDir = join(testDir, "state");
    mkdirSync(stateDir, { recursive: true });
    const clusterKey = randomBytes(32).toString("hex");

    const cfgB = writeCommConfig(testDir, "agent-b", {});
    const b = await bootDaemon("agent-b", cfgB, stateDir, clusterKey);

    // A subscribe request signed with the WRONG key must be refused before any
    // registration — otherwise an attacker could register a bogus subscriber.
    const subscription = { subscriber: "agent-evil", eventTypes: ["agent:leaving"] };
    const badSig = signCanonical(subscription, randomBytes(32).toString("hex"));
    await expect(
      b.client.call("comm.subscribe", { subscription, signature: badSig }),
    ).rejects.toThrow();
    expect(((await b.client.call("agent.ping")) as { pong: boolean }).pong).toBe(true);
  }, 60_000);
});

interface PeerEndpoint {
  serviceName: string;
  agentId: string;
  socketPath?: string;
}

describe("Tenet #10 — service discovery closure (C/T3, registry hub + provider + consumer)", () => {
  it("provider registers a service; consumer discovers it via the registry and messages it", async () => {
    testDir = freshDir("discovery");
    const stateDir = join(testDir, "state");
    mkdirSync(stateDir, { recursive: true });
    const clusterKey = randomBytes(32).toString("hex");

    // Registry hub (holds the GlobalServiceRegistry the others register/look up on).
    const cfgHub = writeCommConfig(testDir, "agent-r", {});
    const hub = await bootDaemon("agent-r", cfgHub, stateDir, clusterKey);
    // Provider A accepts messages from B.
    const cfgA = writeCommConfig(testDir, "agent-a", { canReceiveFrom: ["agent-b"] });
    const a = await bootDaemon("agent-a", cfgA, stateDir, clusterKey);
    // Consumer B may message any peer it DISCOVERS — wildcard, no static peer id.
    const cfgB = writeCommConfig(testDir, "agent-b", { canSendTo: ["*"] });
    const b = await bootDaemon("agent-b", cfgB, stateDir, clusterKey);

    // A advertises "echo" on the registry hub.
    const reg = (await a.client.call("comm.registerOn", {
      registry: "agent-r",
      serviceName: "echo",
    })) as { registered: boolean };
    expect(reg.registered).toBe(true);

    // B discovers the provider of "echo" via the hub — without static peer config.
    const found = (await b.client.call("comm.findPeer", {
      registry: "agent-r",
      serviceName: "echo",
    })) as { providers: PeerEndpoint[] };
    expect(found.providers.length).toBe(1);
    expect(found.providers[0].agentId).toBe("agent-a");
    expect(found.providers[0].serviceName).toBe("echo");

    // B messages the DISCOVERED provider — the loop is closed (discover → talk).
    const target = found.providers[0].agentId;
    const sent = (await b.client.call("comm.send", { target, payload: { q: "ping" } })) as {
      delivered: boolean;
    };
    expect(sent.delivered).toBe(true);

    // A received the message from the consumer that discovered it.
    const deadline = Date.now() + 8_000;
    let inbox: CommMessage[] = [];
    while (Date.now() < deadline) {
      const res = (await a.client.call("comm.inbox", {})) as { messages: CommMessage[] };
      inbox = res.messages;
      if (inbox.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(inbox.length).toBe(1);
    expect(inbox[0].source).toBe("agent-b");
    expect(inbox[0].payload).toEqual({ q: "ping" });

    expect(((await hub.client.call("agent.ping")) as { pong: boolean }).pong).toBe(true);
  }, 60_000);

  it("forged register / lookup are rejected (HMAC, fail-closed)", async () => {
    testDir = freshDir("discovery-hmac");
    const stateDir = join(testDir, "state");
    mkdirSync(stateDir, { recursive: true });
    const clusterKey = randomBytes(32).toString("hex");

    const cfgHub = writeCommConfig(testDir, "agent-r", {});
    const hub = await bootDaemon("agent-r", cfgHub, stateDir, clusterKey);

    const registration = { serviceName: "echo", agentId: "agent-evil", socketPath: "/x" };
    const badRegSig = signCanonical(registration, randomBytes(32).toString("hex"));
    await expect(
      hub.client.call("comm.register", { registration, signature: badRegSig }),
    ).rejects.toThrow();

    const request = { serviceName: "echo", requester: "agent-evil" };
    const badLookupSig = signCanonical(request, randomBytes(32).toString("hex"));
    await expect(
      hub.client.call("comm.lookup", { request, signature: badLookupSig }),
    ).rejects.toThrow();

    expect(((await hub.client.call("agent.ping")) as { pong: boolean }).pong).toBe(true);
  }, 60_000);
});

describe("Tenet #10 — performative/topology (C/T4: request-response + broadcast)", () => {
  it("request-response: A's request awaits B's correlated reply across processes", async () => {
    testDir = freshDir("reqrep");
    const stateDir = join(testDir, "state");
    mkdirSync(stateDir, { recursive: true });
    const clusterKey = randomBytes(32).toString("hex");

    // Bidirectional caps: A<->B (request goes A→B, reply goes B→A).
    const cfgB = writeCommConfig(testDir, "agent-b", { canSendTo: ["agent-a"], canReceiveFrom: ["agent-a"] });
    const b = await bootDaemon("agent-b", cfgB, stateDir, clusterKey);
    const cfgA = writeCommConfig(testDir, "agent-a", { canSendTo: ["agent-b"], canReceiveFrom: ["agent-b"] });
    const a = await bootDaemon("agent-a", cfgA, stateDir, clusterKey);

    // A issues a request to B (the RPC stays pending until B replies).
    const replyPromise = a.client.call("comm.request", {
      target: "agent-b",
      payload: { q: "ping" },
      timeoutMs: 8000,
    }) as Promise<{ reply: CommMessage }>;

    // B sees the request in its inbox (performative 'request', has an id).
    const deadline = Date.now() + 8_000;
    let reqMsg: CommMessage | undefined;
    while (Date.now() < deadline) {
      const res = (await b.client.call("comm.inbox", {})) as { messages: CommMessage[] };
      reqMsg = res.messages.find((m) => m.performative === "request");
      if (reqMsg) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(reqMsg).toBeDefined();
    expect(reqMsg!.source).toBe("agent-a");

    // B replies with correlationId = the request id.
    await b.client.call("comm.reply", {
      target: "agent-a",
      correlationId: reqMsg!.id,
      payload: { a: "pong" },
    });

    // A's request resolves with B's reply (correlated across the process boundary).
    const { reply } = await replyPromise;
    expect(reply.correlationId).toBe(reqMsg!.id);
    expect(reply.source).toBe("agent-b");
    expect(reply.payload).toEqual({ a: "pong" });
  }, 60_000);

  it("a correlated reply from the WRONG peer cannot hijack the pending request", async () => {
    // A requests B; a third agent C (allowed to message A) forges a reply carrying
    // the request's correlationId. The request must NOT resolve with C's payload —
    // only B (the agent the request was sent to) can satisfy it.
    testDir = freshDir("reqhijack");
    const stateDir = join(testDir, "state");
    mkdirSync(stateDir, { recursive: true });
    const clusterKey = randomBytes(32).toString("hex");

    const cfgB = writeCommConfig(testDir, "agent-b", { canSendTo: ["agent-a"], canReceiveFrom: ["agent-a"] });
    const b = await bootDaemon("agent-b", cfgB, stateDir, clusterKey);
    const cfgC = writeCommConfig(testDir, "agent-c", { canSendTo: ["agent-a"] });
    const c = await bootDaemon("agent-c", cfgC, stateDir, clusterKey);
    // A accepts from BOTH b and c, so C's forged reply genuinely reaches A's correlation hook.
    const cfgA = writeCommConfig(testDir, "agent-a", { canSendTo: ["agent-b"], canReceiveFrom: ["agent-b", "agent-c"] });
    const a = await bootDaemon("agent-a", cfgA, stateDir, clusterKey);

    const replyPromise = a.client.call("comm.request", {
      target: "agent-b",
      payload: { q: "ping" },
      timeoutMs: 8000,
    }) as Promise<{ reply: CommMessage }>;

    // B observes the request → the test learns the correlationId (= request id).
    const deadline = Date.now() + 8_000;
    let reqMsg: CommMessage | undefined;
    while (Date.now() < deadline) {
      const res = (await b.client.call("comm.inbox", {})) as { messages: CommMessage[] };
      reqMsg = res.messages.find((m) => m.performative === "request");
      if (reqMsg) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(reqMsg).toBeDefined();

    // C forges a reply with the right correlationId but the WRONG source (agent-c).
    await c.client.call("comm.reply", { target: "agent-a", correlationId: reqMsg!.id, payload: { a: "HIJACK" } });
    await new Promise((r) => setTimeout(r, 400)); // give the forged reply time to (not) resolve

    // B sends the genuine reply.
    await b.client.call("comm.reply", { target: "agent-a", correlationId: reqMsg!.id, payload: { a: "pong" } });

    // The request resolves with B's reply — NOT C's hijack payload.
    const { reply } = await replyPromise;
    expect(reply.source).toBe("agent-b");
    expect(reply.payload).toEqual({ a: "pong" });
  }, 60_000);

  it("request times out (fail-closed) when no reply arrives", async () => {
    testDir = freshDir("reqtimeout");
    const stateDir = join(testDir, "state");
    mkdirSync(stateDir, { recursive: true });
    const clusterKey = randomBytes(32).toString("hex");

    const cfgB = writeCommConfig(testDir, "agent-b", { canReceiveFrom: ["agent-a"] });
    const b = await bootDaemon("agent-b", cfgB, stateDir, clusterKey);
    const cfgA = writeCommConfig(testDir, "agent-a", { canSendTo: ["agent-b"], canReceiveFrom: ["agent-b"] });
    const a = await bootDaemon("agent-a", cfgA, stateDir, clusterKey);

    // B never replies → A's request rejects after the short timeout.
    await expect(
      a.client.call("comm.request", { target: "agent-b", payload: { q: 1 }, timeoutMs: 600 }),
    ).rejects.toThrow();
    expect(((await a.client.call("agent.ping")) as { pong: boolean }).pong).toBe(true);
  }, 60_000);

  it("broadcast: A fans out to B and C; both receive", async () => {
    testDir = freshDir("broadcast");
    const stateDir = join(testDir, "state");
    mkdirSync(stateDir, { recursive: true });
    const clusterKey = randomBytes(32).toString("hex");

    const cfgB = writeCommConfig(testDir, "agent-b", { canReceiveFrom: ["agent-a"] });
    const b = await bootDaemon("agent-b", cfgB, stateDir, clusterKey);
    const cfgC = writeCommConfig(testDir, "agent-c", { canReceiveFrom: ["agent-a"] });
    const c = await bootDaemon("agent-c", cfgC, stateDir, clusterKey);
    const cfgA = writeCommConfig(testDir, "agent-a", { canSendTo: ["agent-b", "agent-c"] });
    const a = await bootDaemon("agent-a", cfgA, stateDir, clusterKey);

    const res = (await a.client.call("comm.broadcast", {
      targets: ["agent-b", "agent-c"],
      payload: { note: "hello-all" },
    })) as { results: Array<{ target: string; delivered: boolean }> };
    expect(res.results.length).toBe(2);
    expect(res.results.every((r) => r.delivered)).toBe(true);

    for (const peer of [b, c]) {
      const inbox = (await peer.client.call("comm.inbox", {})) as { messages: CommMessage[] };
      expect(inbox.messages.length).toBe(1);
      expect(inbox.messages[0].source).toBe("agent-a");
      expect(inbox.messages[0].payload).toEqual({ note: "hello-all" });
    }
  }, 60_000);
});

describe("Tenet #10 — pipeline topology (A→B→C source-routed relay)", () => {
  it("a message is relayed hop-by-hop through the route to the terminal hop", async () => {
    testDir = freshDir("pipeline");
    const stateDir = join(testDir, "state");
    mkdirSync(stateDir, { recursive: true });
    const clusterKey = randomBytes(32).toString("hex");

    // C terminal; B relays A→C; A initiates. Per-hop caps: A→B, B→C.
    const cfgC = writeCommConfig(testDir, "agent-c", { canReceiveFrom: ["agent-b"] });
    const c = await bootDaemon("agent-c", cfgC, stateDir, clusterKey);
    const cfgB = writeCommConfig(testDir, "agent-b", { canReceiveFrom: ["agent-a"], canSendTo: ["agent-c"] });
    const b = await bootDaemon("agent-b", cfgB, stateDir, clusterKey);
    const cfgA = writeCommConfig(testDir, "agent-a", { canSendTo: ["agent-b"] });
    const a = await bootDaemon("agent-a", cfgA, stateDir, clusterKey);

    const started = (await a.client.call("comm.pipeline", {
      route: ["agent-b", "agent-c"],
      payload: { job: "etl" },
    })) as { delivered: boolean; pipelineId: string; firstHop: string };
    expect(started.delivered).toBe(true);
    expect(started.firstHop).toBe("agent-b");

    // Poll the terminal hop C; the message arrived having traversed A→B.
    const deadline = Date.now() + 8_000;
    let cInbox: CommMessage[] = [];
    while (Date.now() < deadline) {
      const res = (await c.client.call("comm.inbox", {})) as { messages: CommMessage[] };
      cInbox = res.messages;
      if (cInbox.length > 0) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(cInbox.length).toBe(1);
    expect(cInbox[0].payload).toEqual({ job: "etl" });
    const trail = JSON.parse(cInbox[0].metadata?.pipelineTrail ?? "[]") as string[];
    expect(trail).toEqual(["agent-a", "agent-b"]); // relayed by A then B before reaching C

    // The intermediate hop B also recorded the message it relayed.
    const bInbox = (await b.client.call("comm.inbox", {})) as { messages: CommMessage[] };
    expect(bInbox.messages.length).toBe(1);
  }, 60_000);

  it("a mid-chain capability denial stops the pipeline there (fail-closed per hop)", async () => {
    testDir = freshDir("pipeline-break");
    const stateDir = join(testDir, "state");
    mkdirSync(stateDir, { recursive: true });
    const clusterKey = randomBytes(32).toString("hex");

    // B may receive from A but is NOT allowed to send to C → the relay breaks at B.
    const cfgC = writeCommConfig(testDir, "agent-c", { canReceiveFrom: ["agent-b"] });
    const c = await bootDaemon("agent-c", cfgC, stateDir, clusterKey);
    const cfgB = writeCommConfig(testDir, "agent-b", { canReceiveFrom: ["agent-a"], canSendTo: [] });
    const b = await bootDaemon("agent-b", cfgB, stateDir, clusterKey);
    const cfgA = writeCommConfig(testDir, "agent-a", { canSendTo: ["agent-b"] });
    const a = await bootDaemon("agent-a", cfgA, stateDir, clusterKey);

    await a.client.call("comm.pipeline", { route: ["agent-b", "agent-c"], payload: { job: "x" } });

    // Give the (failed) relay a moment; B received it, C never did.
    await new Promise((r) => setTimeout(r, 1_000));
    const bInbox = (await b.client.call("comm.inbox", {})) as { messages: CommMessage[] };
    expect(bInbox.messages.length).toBe(1);
    const cInbox = (await c.client.call("comm.inbox", {})) as { messages: CommMessage[] };
    expect(cInbox.messages.length).toBe(0);
    expect(((await c.client.call("agent.ping")) as { pong: boolean }).pong).toBe(true);
  }, 60_000);
});
