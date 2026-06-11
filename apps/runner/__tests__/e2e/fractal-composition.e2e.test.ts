/**
 * Fractal composition e2e — the Tenet #10 proof (TENET-2026-06-11).
 *
 * Two real OS processes, depth 2:
 *   - PARENT agent (this test spawns it): scripted provider + agent-ask +
 *     mcp-server(HTTP, the unified interface) + mcp-client(stdio).
 *   - CHILD agent: spawned BY THE PARENT (mcp-client's StdioTransport runs
 *     `node dist/bin.js start --config child.json`): scripted provider +
 *     agent-ask + mcp-server(stdio).
 *
 * Proven end to end:
 *   (a) composite agent — the parent's ONE MCP endpoint lists both its own
 *       `agent.ask` and the bridged `child-agent/agent.ask`;
 *   (b) sub-AGENTS, not tool stubs — the delegated answer is produced by the
 *       CHILD's cognition loop (its provider writes a PID breadcrumb), and
 *       the round-trip marker is `PARENT-FINAL:CHILD-ANSWER:<childPid>:...`
 *       with childPid !== parentPid;
 *   (c) unified interface — one HTTP JSON-RPC endpoint fronts the ensemble;
 *   (d) lifecycle — killing the parent reaps the child (StdioTransport
 *       SIGTERM→SIGKILL cascade).
 *
 * Honesty boundary: inter-agent routing here is MCP (the only delivery that
 * works in this codebase). MessageRouter / apps-channel / comm-pipeline are
 * validation-only or unwired and are NOT exercised or claimed.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../..");
const DIST_BIN = resolve(REPO_ROOT, "apps/runner/dist/bin.js");
const FIXTURE = resolve(REPO_ROOT, "apps/runner/__tests__/e2e/fixtures/scripted-provider.mjs");
const PORT = 20000 + (process.pid % 20000);
const ENDPOINT = `http://127.0.0.1:${PORT}/`;

let tempDir: string;
let parent: ChildProcess | null = null;
let parentStderr = "";
let childPidFile: string;

function killPidTree(pid: number): void {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch { /* already gone */ }
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function rpc(method: string, params?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params ?? {} }),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function listToolNames(): Promise<string[]> {
  const res = await rpc("tools/list");
  const result = res.result as { tools?: Array<{ name: string }> } | undefined;
  return (result?.tools ?? []).map((t) => t.name);
}

function writeConfigs(): { parentCfg: string; childCfg: string } {
  childPidFile = join(tempDir, "child.pid");
  const childCfg = join(tempDir, "child.json");
  const parentCfg = join(tempDir, "parent.json");

  writeFileSync(childCfg, JSON.stringify({
    identity: { id: "fractal-child", name: "Fractal Child", version: "0.1.0" },
    cognition: { provider: "scripted", model: "scripted-1", maxToolRounds: 3 },
    capabilities: { tools: ["agent.ask"], allowedPaths: [tempDir] },
    policy: { toolTimeout: 30000 },
    memory: { slidingWindowSize: 5 },
    plugins: [
      { name: "@openstarry-plugin/context-sliding-window" },
      { name: "scripted-provider", path: FIXTURE, config: { mode: "child", breadcrumb: childPidFile } },
      { name: "@openstarry-plugin/agent-ask" },
      { name: "@openstarry-plugin/guide-character-init" },
      {
        name: "@openstarry-plugin/mcp-server",
        config: { name: "fractal-child", version: "0.1.0", transport: "stdio", exposedTools: "*" },
      },
    ],
    guide: "default-guide",
  }, null, 2));

  writeFileSync(parentCfg, JSON.stringify({
    identity: { id: "fractal-parent", name: "Fractal Parent", version: "0.1.0" },
    cognition: { provider: "scripted", model: "scripted-1", maxToolRounds: 3 },
    capabilities: { tools: ["agent.ask", "child-agent/agent.ask"], allowedPaths: [tempDir] },
    policy: { toolTimeout: 45000 },
    memory: { slidingWindowSize: 5 },
    plugins: [
      { name: "@openstarry-plugin/context-sliding-window" },
      { name: "scripted-provider", path: FIXTURE, config: { mode: "parent", delegateTool: "child-agent/agent.ask" } },
      { name: "@openstarry-plugin/agent-ask" },
      { name: "@openstarry-plugin/guide-character-init" },
      {
        name: "@openstarry-plugin/mcp-client",
        config: {
          servers: [{
            name: "child-agent",
            transport: "stdio",
            command: process.execPath,
            args: [DIST_BIN, "start", "--config", childCfg, "--no-project-dir"],
          }],
        },
      },
      {
        name: "@openstarry-plugin/mcp-server",
        config: { name: "fractal-parent", version: "0.1.0", transport: "http", host: "127.0.0.1", port: PORT, exposedTools: "*" },
      },
    ],
    guide: "default-guide",
  }, null, 2));

  return { parentCfg, childCfg };
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "fractal-e2e-"));
  const { parentCfg } = writeConfigs();

  parent = spawn(process.execPath, [DIST_BIN, "start", "--config", parentCfg, "--no-project-dir"], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: tempDir,
  });
  parent.stderr!.on("data", (chunk: Buffer) => { parentStderr += chunk.toString("utf-8"); });
  parent.stdout!.on("data", () => { /* parent stdout unused (no stdio plugin) */ });

  // Readiness = the parent HTTP endpoint answers AND the child's bridged
  // tool is present (child spawn + MCP handshake complete).
  const deadline = Date.now() + 45_000;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`fractal parent not ready in 45s.\n--- parent stderr ---\n${parentStderr.slice(-4000)}`);
    }
    try {
      const names = await listToolNames();
      if (names.includes("agent.ask") && names.includes("child-agent/agent.ask")) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
}, 60_000);

afterAll(() => {
  if (parent?.pid) killPidTree(parent.pid);
  if (childPidFile && existsSync(childPidFile)) {
    const childPid = Number(readFileSync(childPidFile, "utf-8"));
    if (Number.isFinite(childPid)) killPidTree(childPid);
  }
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe("Tenet #10 — fractal composition (2 processes, depth 2)", () => {
  it("T1 unified surface: ONE endpoint lists the parent's own ask AND the bridged child ask", async () => {
    const names = await listToolNames();
    expect(names).toContain("agent.ask");
    expect(names).toContain("child-agent/agent.ask");
  }, 30_000);

  it("T2 delegation round-trip: parent cognition delegates to child cognition and answers out the unified interface", async () => {
    const res = await rpc("tools/call", { name: "agent.ask", arguments: { prompt: "hello fractal", timeoutMs: 40000 } });
    const result = res.result as { content?: Array<{ type: string; text: string }>; isError?: boolean } | undefined;
    expect(result?.isError ?? false).toBe(false);
    const text = result?.content?.[0]?.text ?? "";

    // Child's PID breadcrumb proves the CHILD's provider (its cognition loop)
    // produced the inner answer in a separate OS process.
    expect(existsSync(childPidFile)).toBe(true);
    const childPid = Number(readFileSync(childPidFile, "utf-8"));
    expect(Number.isFinite(childPid)).toBe(true);
    expect(childPid).not.toBe(parent!.pid);
    expect(childPid).not.toBe(process.pid);

    expect(text).toBe(`PARENT-FINAL:CHILD-ANSWER:${childPid}:HELLO FRACTAL`);
  }, 60_000);

  it("T3 composition surface: the bridged child tool is directly callable through the parent endpoint", async () => {
    const res = await rpc("tools/call", { name: "child-agent/agent.ask", arguments: { prompt: "direct line" } });
    const result = res.result as { content?: Array<{ type: string; text: string }> } | undefined;
    const text = result?.content?.[0]?.text ?? "";
    const childPid = Number(readFileSync(childPidFile, "utf-8"));
    expect(text).toBe(`CHILD-ANSWER:${childPid}:DIRECT LINE`);
  }, 60_000);

  it("T4 lifecycle: killing the parent reaps the child (no orphan)", async () => {
    const childPid = Number(readFileSync(childPidFile, "utf-8"));
    expect(isPidRunning(childPid)).toBe(true);

    killPidTree(parent!.pid!);
    parent = null;

    const deadline = Date.now() + 10_000;
    while (isPidRunning(childPid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(isPidRunning(childPid)).toBe(false);
  }, 30_000);
});
