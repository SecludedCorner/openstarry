/**
 * Plan46 W2 — CheckpointManager + hook-capture integration.
 *
 * Verifies:
 *   - createCheckpointManager aggregates onCheckpoint across plugins
 *   - restore() dispatches snapshots by name and is a no-op for absent hooks
 *   - capturePluginHooks collects only plugins that expose check/restore
 *   - Round-trip: checkpoint → mutate → restore → original state
 */

import { describe, it, expect, vi } from "vitest";
import {
  createCheckpointManager,
} from "../../src/utils/checkpoint-manager.js";
import { capturePluginHooks } from "../../src/utils/tool-filter-proxy.js";
import type {
  IPlugin,
  IPluginContext,
  PluginHooks,
  PluginSnapshot,
} from "@openstarry/sdk";

function makeCtx(): IPluginContext {
  return {
    bus: { on: vi.fn(), once: vi.fn(), onAny: vi.fn(), emit: vi.fn() },
    workingDirectory: "/test",
    agentId: "test-agent",
    config: {},
    pushInput: vi.fn(),
    sessions: {
      create: vi.fn(),
      get: vi.fn(),
      list: vi.fn(() => []),
      destroy: vi.fn(() => true),
      getStateManager: vi.fn(),
      getDefaultSession: vi.fn(),
    },
  } as unknown as IPluginContext;
}

describe("CheckpointManager", () => {
  it("checkpoint() collects snapshots from plugins that expose onCheckpoint", () => {
    const plugins = new Map<string, PluginHooks>([
      ["p1", { onCheckpoint: () => ({ pluginName: "p1", schemaVersion: 1, state: { x: 1 }, timestamp: 100 }) }],
      ["p2", { onCheckpoint: () => ({ pluginName: "p2", schemaVersion: 1, state: { y: "z" }, timestamp: 200 }) }],
      ["p3", {}], // no hook — skipped
    ]);
    const mgr = createCheckpointManager(plugins);
    const snaps = mgr.checkpoint();
    expect(snaps.size).toBe(2);
    expect(snaps.get("p1")?.state).toEqual({ x: 1 });
    expect(snaps.get("p2")?.state).toEqual({ y: "z" });
    expect(snaps.has("p3")).toBe(false);
  });

  it("checkpoint() skips snapshot when onCheckpoint returns null", () => {
    const plugins = new Map<string, PluginHooks>([
      ["p1", { onCheckpoint: () => null }],
    ]);
    const mgr = createCheckpointManager(plugins);
    expect(mgr.checkpoint().size).toBe(0);
  });

  it("checkpoint() isolates throwing plugin (does not poison batch)", () => {
    const plugins = new Map<string, PluginHooks>([
      ["bad", { onCheckpoint: () => { throw new Error("boom"); } }],
      ["good", { onCheckpoint: () => ({ pluginName: "good", schemaVersion: 1, state: {}, timestamp: 0 }) }],
    ]);
    const mgr = createCheckpointManager(plugins);
    const snaps = mgr.checkpoint();
    expect(snaps.size).toBe(1);
    expect(snaps.has("good")).toBe(true);
  });

  it("restore() invokes onRestore for matching names and ignores unknown plugins", () => {
    const restored: string[] = [];
    const plugins = new Map<string, PluginHooks>([
      ["p1", { onRestore: (s: PluginSnapshot) => restored.push(`p1:${JSON.stringify(s.state)}`) }],
    ]);
    const mgr = createCheckpointManager(plugins);
    const snaps = new Map<string, PluginSnapshot>([
      ["p1", { pluginName: "p1", schemaVersion: 1, state: { k: 1 }, timestamp: 0 }],
      ["unknown", { pluginName: "unknown", schemaVersion: 1, state: {}, timestamp: 0 }],
    ]);
    mgr.restore(snaps);
    expect(restored).toEqual([`p1:${JSON.stringify({ k: 1 })}`]);
  });

  it("restore() catches onRestore throws (fresh-state fallback semantics)", () => {
    const plugins = new Map<string, PluginHooks>([
      ["p1", { onRestore: () => { throw new Error("corrupt"); } }],
    ]);
    const mgr = createCheckpointManager(plugins);
    expect(() => mgr.restore(new Map([
      ["p1", { pluginName: "p1", schemaVersion: 1, state: {}, timestamp: 0 }],
    ]))).not.toThrow();
  });
});

describe("capturePluginHooks — Plan46 W2 hook-capture wrapper", () => {
  it("captures hooks when factory returns onCheckpoint/onRestore", async () => {
    const snap: PluginSnapshot = { pluginName: "cap", schemaVersion: 1, state: {}, timestamp: 0 };
    const plugin: IPlugin = {
      manifest: { name: "cap", version: "0.0.1" },
      factory: async () => ({ onCheckpoint: () => snap, onRestore: () => undefined }),
    };
    const hookMap = new Map<string, PluginHooks>();
    const wrapped = capturePluginHooks(plugin, hookMap);
    await wrapped.factory(makeCtx());
    expect(hookMap.has("cap")).toBe(true);
    expect(hookMap.get("cap")!.onCheckpoint!()).toBe(snap);
  });

  it("does not capture plugins without check/restore hooks", async () => {
    const plugin: IPlugin = {
      manifest: { name: "no-hooks", version: "0.0.1" },
      factory: async () => ({ tools: [] }),
    };
    const hookMap = new Map<string, PluginHooks>();
    const wrapped = capturePluginHooks(plugin, hookMap);
    await wrapped.factory(makeCtx());
    expect(hookMap.size).toBe(0);
  });

  it("passes through the hooks object unchanged to the caller", async () => {
    const hooks: PluginHooks = { onCheckpoint: () => null };
    const plugin: IPlugin = {
      manifest: { name: "p", version: "0.0.1" },
      factory: async () => hooks,
    };
    const wrapped = capturePluginHooks(plugin, new Map());
    const returned = await wrapped.factory(makeCtx());
    expect(returned).toBe(hooks);
  });
});

describe("CheckpointManager — round-trip with stateful fake plugin", () => {
  // Minimal stateful plugin used to exercise the full capture → checkpoint →
  // restore cycle without depending on spc-monitor internals.
  class Counter {
    constructor(public value = 0) {}
    hooks(): PluginHooks {
      return {
        onCheckpoint: (): PluginSnapshot => ({
          pluginName: "counter",
          schemaVersion: 1,
          state: { value: this.value },
          timestamp: 42,
        }),
        onRestore: (snap) => {
          if (snap.pluginName !== "counter") throw new Error("wrong name");
          const v = snap.state["value"];
          if (typeof v !== "number") throw new Error("shape");
          this.value = v;
        },
      };
    }
  }

  it("checkpoint → mutate → restore brings state back", () => {
    const c = new Counter(7);
    const plugins = new Map<string, PluginHooks>([["counter", c.hooks()]]);
    const mgr = createCheckpointManager(plugins);
    const snaps = mgr.checkpoint();

    c.value = 999; // drift
    mgr.restore(snaps);
    expect(c.value).toBe(7);
  });
});
