/**
 * Fractal composition depth=3 e2e (GAP-2026-06-11 — extends the Tenet #10
 * proof from N=2/depth=2 to a three-generation chain).
 *
 * THREE real OS processes, each a full agent with its own cognition loop:
 *   PARENT (spawned by this test; MCP HTTP = the unified interface)
 *     └─ spawns MIDDLE via mcp-client stdio at its own boot
 *          └─ spawns GRANDCHILD via ITS mcp-client stdio at ITS boot
 *
 * One external call → three cognition loops:
 *   tools/call agent.ask → parent loop delegates to middle-agent/agent.ask →
 *   middle loop delegates to grandchild-agent/agent.ask → grandchild loop
 *   answers (PID breadcrumb) → middle wraps MID-FINAL: → parent wraps
 *   PARENT-FINAL: → out the single endpoint.
 *
 * The recursive structure IS the tenet: every level uses the identical
 * mechanism (agent-ask + mcp-server + mcp-client) — "由一而生萬物".
 * Honest boundary: depth=3 composition chain; the COMPOSITE_AGENT_MAX_DEPTH
 * daemon ceiling governs daemon spawnChild, which is a separate machinery
 * (attested in daemon-process-tree.e2e.test.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../..");
const DIST_BIN = resolve(REPO_ROOT, "apps/runner/dist/bin.js");
const FIXTURE = resolve(REPO_ROOT, "apps/runner/__tests__/e2e/fixtures/scripted-provider.mjs");
const PORT = 21000 + (process.pid % 20000);
const ENDPOINT = `http://127.0.0.1:${PORT}/`;

let tempDir: string;
let parent: ChildProcess | null = null;
let parentStderr = "";
let midPidFile: string;
let grandchildPidFile: string;

function killPidTree(pid: number): void {
  try {
    if (process.platform === "win32") execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    else process.kill(pid, "SIGKILL");
  } catch { /* gone */ }
}

async function rpc(method: string, params?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params ?? {} }),
  });
  return (await res.json()) as Record<string, unknown>;
}

function writeConfigs(): string {
  midPidFile = join(tempDir, "mid.pid");
  grandchildPidFile = join(tempDir, "grandchild.pid");
  const grandchildCfg = join(tempDir, "grandchild.json");
  const middleCfg = join(tempDir, "middle.json");
  const parentCfg = join(tempDir, "parent.json");

  // Generation 3 — leaf: answers with its own cognition + PID breadcrumb.
  writeFileSync(grandchildCfg, JSON.stringify({
    identity: { id: "fractal-grandchild", name: "Fractal Grandchild", version: "0.1.0" },
    cognition: { provider: "scripted", model: "scripted-1", maxToolRounds: 3 },
    capabilities: { tools: ["agent.ask"], allowedPaths: [tempDir] },
    policy: { toolTimeout: 30000 },
    memory: { slidingWindowSize: 5 },
    plugins: [
      { name: "@openstarry-plugin/context-sliding-window" },
      { name: "scripted-provider", path: FIXTURE, config: { mode: "child", breadcrumb: grandchildPidFile } },
      { name: "@openstarry-plugin/agent-ask" },
      { name: "@openstarry-plugin/guide-character-init" },
      { name: "@openstarry-plugin/mcp-server", config: { name: "fractal-grandchild", version: "0.1.0", transport: "stdio", exposedTools: "*" } },
    ],
    guide: "default-guide",
  }, null, 2));

  // Generation 2 — middle: SAME shape as the parent (the recursion):
  // delegates to ITS child, wraps with MID-FINAL:, exposes mcp-server stdio,
  // and writes its own PID breadcrumb via the parent-mode provider? No —
  // parent mode has no breadcrumb; middle PID comes from the wrapper of
  // grandchild spawn... we capture it via a tiny trick: the middle's
  // breadcrumb is unnecessary for the assertion chain (markers prove the
  // three loops); we still record it for cleanup via taskkill /T on parent.
  writeFileSync(middleCfg, JSON.stringify({
    identity: { id: "fractal-middle", name: "Fractal Middle", version: "0.1.0" },
    cognition: { provider: "scripted", model: "scripted-1", maxToolRounds: 3 },
    capabilities: { tools: ["agent.ask", "grandchild-agent/agent.ask"], allowedPaths: [tempDir] },
    policy: { toolTimeout: 40000 },
    memory: { slidingWindowSize: 5 },
    plugins: [
      { name: "@openstarry-plugin/context-sliding-window" },
      { name: "scripted-provider", path: FIXTURE, config: { mode: "parent", delegateTool: "grandchild-agent/agent.ask", finalPrefix: "MID-FINAL:" } },
      { name: "@openstarry-plugin/agent-ask" },
      { name: "@openstarry-plugin/guide-character-init" },
      {
        name: "@openstarry-plugin/mcp-client",
        config: { servers: [{ name: "grandchild-agent", transport: "stdio", command: process.execPath, args: [DIST_BIN, "start", "--config", grandchildCfg, "--no-project-dir"] }] },
      },
      { name: "@openstarry-plugin/mcp-server", config: { name: "fractal-middle", version: "0.1.0", transport: "stdio", exposedTools: "*" } },
    ],
    guide: "default-guide",
  }, null, 2));

  // Generation 1 — parent: unified HTTP interface.
  writeFileSync(parentCfg, JSON.stringify({
    identity: { id: "fractal-parent3", name: "Fractal Parent3", version: "0.1.0" },
    cognition: { provider: "scripted", model: "scripted-1", maxToolRounds: 3 },
    capabilities: { tools: ["agent.ask", "middle-agent/agent.ask"], allowedPaths: [tempDir] },
    policy: { toolTimeout: 50000 },
    memory: { slidingWindowSize: 5 },
    plugins: [
      { name: "@openstarry-plugin/context-sliding-window" },
      { name: "scripted-provider", path: FIXTURE, config: { mode: "parent", delegateTool: "middle-agent/agent.ask", finalPrefix: "PARENT-FINAL:" } },
      { name: "@openstarry-plugin/agent-ask" },
      { name: "@openstarry-plugin/guide-character-init" },
      {
        name: "@openstarry-plugin/mcp-client",
        config: { servers: [{ name: "middle-agent", transport: "stdio", command: process.execPath, args: [DIST_BIN, "start", "--config", middleCfg, "--no-project-dir"] }] },
      },
      { name: "@openstarry-plugin/mcp-server", config: { name: "fractal-parent3", version: "0.1.0", transport: "http", host: "127.0.0.1", port: PORT, exposedTools: "*" } },
    ],
    guide: "default-guide",
  }, null, 2));

  return parentCfg;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "fractal3-e2e-"));
  const parentCfg = writeConfigs();

  parent = spawn(process.execPath, [DIST_BIN, "start", "--config", parentCfg, "--no-project-dir"], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: tempDir,
  });
  parent.stderr!.on("data", (c: Buffer) => { parentStderr += c.toString("utf-8"); });
  parent.stdout!.on("data", () => { /* unused */ });

  // Ready when the three-generation chain is fully bridged: the parent's
  // endpoint must list the middle's bridged ask (which itself only exists
  // after the middle bridged the grandchild — boot is sequential).
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`depth-3 chain not ready in 60s.\n--- parent stderr ---\n${parentStderr.slice(-4000)}`);
    }
    try {
      const res = await rpc("tools/list");
      const names = ((res.result as { tools?: Array<{ name: string }> })?.tools ?? []).map((t) => t.name);
      if (names.includes("agent.ask") && names.includes("middle-agent/agent.ask")) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
}, 90_000);

afterAll(() => {
  if (parent?.pid) killPidTree(parent.pid); // /T kills the whole tree on win32
  for (const f of [midPidFile, grandchildPidFile]) {
    if (f && existsSync(f)) {
      const pid = Number(readFileSync(f, "utf-8"));
      if (Number.isFinite(pid)) killPidTree(pid);
    }
  }
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe("Tenet #10 — fractal composition at depth 3 (3 processes, 3 cognition loops)", () => {
  it("one external call traverses three generations and returns the layered markers", async () => {
    const res = await rpc("tools/call", { name: "agent.ask", arguments: { prompt: "hello depth three", timeoutMs: 50000 } });
    const result = res.result as { content?: Array<{ type: string; text: string }>; isError?: boolean } | undefined;
    expect(result?.isError ?? false).toBe(false);
    const text = result?.content?.[0]?.text ?? "";

    expect(existsSync(grandchildPidFile)).toBe(true);
    const grandchildPid = Number(readFileSync(grandchildPidFile, "utf-8"));
    expect(Number.isFinite(grandchildPid)).toBe(true);
    expect(grandchildPid).not.toBe(parent!.pid);
    expect(grandchildPid).not.toBe(process.pid);

    // The layered markers ARE the proof: three distinct loops each stamped
    // the answer on its way back up the chain.
    expect(text).toBe(`PARENT-FINAL:MID-FINAL:CHILD-ANSWER:${grandchildPid}:HELLO DEPTH THREE`);
  }, 90_000);
});
