/**
 * REAL-worker sandbox e2e (v0.59.9) — makes the flagship plugin-isolation subsystem
 * genuinely LIVE. Every other sandbox test mocks node:worker_threads; this one spawns an
 * ACTUAL Worker running the compiled plugin-worker-runner and exercises the real RPC bridge,
 * the runtime CommonJS Module._load block, the pre-spawn static import-analyzer, and the V8
 * memory-limit path. No vi.mock anywhere.
 *
 * Prerequisite: `pnpm build`. The manager resolves the worker runner relative to its OWN
 * module url (getWorkerRunnerPath), so we must drive the COMPILED dist build — under vitest a
 * src import would have no sibling .js. (Same dist-prerequisite precedent as alaya-two-process.e2e.)
 *
 * Honest scope: the heartbeat stall-kill is NOT asserted here — its monitor fires on a fixed
 * 45s heartbeatCheckIntervalMs cadence (not per-plugin configurable), so a real-time stall test
 * would need a >45s wall-clock wait. That path stays covered by the mocked sandbox-heartbeat.test.ts.
 * The ESM interception gap (Module._load is CommonJS-only) is demonstrated, not papered over.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AgentEventType } from "@openstarry/sdk";

const distMgr = resolve(import.meta.dirname, "../../dist/sandbox/sandbox-manager.js");
const distRunner = resolve(import.meta.dirname, "../../dist/sandbox/plugin-worker-runner.js");
const fixturesDir = resolve(import.meta.dirname, "../fixtures/sandbox-plugins");

const TOOL_CTX = { workingDirectory: process.cwd(), allowedPaths: [process.cwd()] };

function makeBus() {
  const any = new Set<(e: any) => void>();
  return {
    on: () => () => {},
    once: () => () => {},
    onAny: (h: (e: any) => void) => {
      any.add(h);
      return () => any.delete(h);
    },
    emit: (e: any) => {
      for (const h of [...any]) {
        try { h(e); } catch { /* ignore */ }
      }
    },
  };
}

function makeDeps(bus: any) {
  return {
    bus,
    pushInput: () => {},
    sessions: {} as any,
    tools: { list: () => [], get: () => undefined },
    guides: { list: () => [] },
    providers: { list: () => [], get: () => undefined },
  };
}

function waitForEvent(bus: any, types: string[], timeoutMs: number): Promise<any> {
  return new Promise((res, rej) => {
    const off = bus.onAny((e: any) => {
      if (types.includes(e.type)) { off(); res(e); }
    });
    setTimeout(() => { off(); rej(new Error(`timeout waiting for ${types.join("|")}`)); }, timeoutMs);
  });
}

/** Build the plugin object the manager consumes. The worker imports the fixture FILE via
 *  _resolvedModulePath; manifest.ref.path (optional) enables the static import-analyzer. */
function pluginRef(
  name: string,
  fixtureFile: string,
  sandbox: Record<string, unknown>,
  withRefPath = false,
): any {
  const abs = resolve(fixturesDir, fixtureFile);
  const manifest: any = { name, version: "1.0.0", sandbox };
  if (withRefPath) manifest.ref = { path: abs };
  return { manifest, factory: async () => ({}), _resolvedModulePath: pathToFileURL(abs).href };
}

const CTX: any = { config: {}, workingDirectory: process.cwd(), agentId: "test" };
const NO_RESTART = { maxRestarts: 0, backoffMs: 50, maxBackoffMs: 50, resetWindowMs: 1000 };

let createPluginSandboxManager: (deps: any) => any;

beforeAll(async () => {
  if (!existsSync(distRunner)) {
    throw new Error(`run \`pnpm build\` first — missing compiled worker runner at ${distRunner}`);
  }
  const mod = await import(pathToFileURL(distMgr).href);
  createPluginSandboxManager = mod.createPluginSandboxManager;
});

describe("sandbox-live e2e (real node:worker_threads)", () => {
  it("round-trips a tool call through a real worker + RPC bridge", async () => {
    const mgr = createPluginSandboxManager(makeDeps(makeBus()));
    try {
      const hooks = await mgr.loadInSandbox(
        pluginRef("fixture-good", "good-tool-plugin.mjs", { enabled: true, memoryLimitMb: 128 }),
        CTX,
      );
      const tool = hooks.tools.find((t: any) => t.id === "echo.upper");
      expect(tool).toBeDefined();
      const out = await tool.execute({ text: "hello sandbox" }, TOOL_CTX);
      expect(out).toBe("HELLO SANDBOX");
    } finally {
      await mgr.shutdownAll();
    }
  }, 30000);

  it("blocks a forbidden require('fs') at RUNTIME via the CommonJS Module._load patch", async () => {
    const mgr = createPluginSandboxManager(makeDeps(makeBus()));
    try {
      const hooks = await mgr.loadInSandbox(
        pluginRef("fixture-forbidden-require", "forbidden-require-plugin.mjs", { enabled: true, memoryLimitMb: 128 }),
        CTX,
      );
      const tool = hooks.tools.find((t: any) => t.id === "read.fs");
      await expect(tool.execute({}, TOOL_CTX)).rejects.toThrow(/forbidden|SANDBOX_MODULE_BLOCKED/i);
    } finally {
      await mgr.shutdownAll();
    }
  }, 30000);

  it("rejects an ESM static import of a forbidden builtin at LOAD via the static analyzer (pre-spawn)", async () => {
    const mgr = createPluginSandboxManager(makeDeps(makeBus()));
    try {
      await expect(
        mgr.loadInSandbox(
          pluginRef("fixture-esm-import", "esm-import-forbidden-plugin.mjs", { enabled: true, memoryLimitMb: 128 }, true),
          CTX,
        ),
      ).rejects.toThrow(/import|forbidden/i);
    } finally {
      await mgr.shutdownAll();
    }
  }, 30000);

  it("trips the worker memory limit on OOM (dedicated worker, real resourceLimits)", async () => {
    const bus = makeBus();
    const mgr = createPluginSandboxManager(makeDeps(bus));
    try {
      const crashed = waitForEvent(
        bus,
        [AgentEventType.SANDBOX_MEMORY_LIMIT_EXCEEDED, AgentEventType.SANDBOX_WORKER_CRASHED],
        35000,
      );
      const hooks = await mgr.loadInSandbox(
        pluginRef("fixture-oom", "oom-plugin.mjs", { enabled: true, memoryLimitMb: 32, restartPolicy: NO_RESTART }),
        CTX,
      );
      const tool = hooks.tools.find((t: any) => t.id === "oom.allocate");
      // Fire-and-forget: the worker dies mid-invoke, so this rejects (RPC rejected on crash).
      tool.execute({}, TOOL_CTX).catch(() => {});
      const evt = await crashed;
      expect([
        AgentEventType.SANDBOX_MEMORY_LIMIT_EXCEEDED,
        AgentEventType.SANDBOX_WORKER_CRASHED,
      ]).toContain(evt.type);
    } finally {
      await mgr.shutdownAll();
    }
  }, 40000);
});
