/**
 * Plan46 W1 — Tool-Level Capability Filtering (runtime enforcement).
 *
 * Rule #68 two-path verification:
 *   Path A (manifest config)   → plugin.manifest.capabilities.allowedTools
 *   Path B (runtime ctx.tools) → filtered accessor delivered to factory(ctx)
 *
 * C46-1 satisfied: filter is applied by the runner wrapper, not Core.
 * C46-4 satisfied: undefined/empty allowedTools leaves ctx.tools untouched.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createToolFilterProxy,
  wrapPluginWithToolFilter,
  type ToolFilterAuditEvent,
} from "../../src/utils/tool-filter-proxy.js";
import type { IPlugin, IPluginContext, ITool, PluginHooks } from "@openstarry/sdk";

function makeTool(id: string): ITool {
  return {
    id,
    description: `tool ${id}`,
    parameters: { type: "object", properties: {} },
    execute: async () => ({ ok: true }),
  } as unknown as ITool;
}

function makeRegistry(tools: ITool[]) {
  const map = new Map(tools.map((t) => [t.id, t] as const));
  return {
    list: () => [...map.values()],
    get: (id: string) => map.get(id),
  };
}

function makeCtx(tools: ITool[] | undefined, overrides?: Partial<IPluginContext>): IPluginContext {
  const registry = tools ? makeRegistry(tools) : undefined;
  return {
    bus: {
      on: vi.fn(() => () => {}),
      once: vi.fn(() => () => {}),
      onAny: vi.fn(() => () => {}),
      emit: vi.fn(),
    },
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
    } as unknown as IPluginContext["sessions"],
    tools: registry,
    ...overrides,
  } as IPluginContext;
}

describe("createToolFilterProxy — ctx.tools filtering", () => {
  it("list() returns only tools whose id is in allowedTools", () => {
    const tools = [makeTool("fs:readFile"), makeTool("fs:writeFile"), makeTool("net:fetch")];
    const proxy = createToolFilterProxy(makeRegistry(tools), ["fs:readFile", "fs:writeFile"], "plugin-a");
    expect(proxy.list().map((t) => t.id)).toEqual(["fs:readFile", "fs:writeFile"]);
  });

  it("get() returns the tool for an allowed id", () => {
    const tools = [makeTool("fs:readFile")];
    const proxy = createToolFilterProxy(makeRegistry(tools), ["fs:readFile"], "plugin-a");
    expect(proxy.get("fs:readFile")?.id).toBe("fs:readFile");
  });

  it("get() returns undefined AND invokes onDenied for a blocked id", () => {
    const tools = [makeTool("fs:readFile"), makeTool("net:fetch")];
    const events: ToolFilterAuditEvent[] = [];
    const proxy = createToolFilterProxy(
      makeRegistry(tools),
      ["fs:readFile"],
      "plugin-a",
      (e) => events.push(e),
    );

    expect(proxy.get("net:fetch")).toBeUndefined();
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event.type).toBe("audit:capability_denied");
    expect(event.plugin).toBe("plugin-a");
    expect(event.tool).toBe("net:fetch");
    expect(event.allowedTools).toEqual(["fs:readFile"]);
    expect(typeof event.timestamp).toBe("string");
    // ISO 8601 format check
    expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
  });

  it("does not invoke onDenied for allowed tool access", () => {
    const tools = [makeTool("fs:readFile")];
    const onDenied = vi.fn();
    const proxy = createToolFilterProxy(makeRegistry(tools), ["fs:readFile"], "plugin-a", onDenied);
    proxy.get("fs:readFile");
    proxy.list();
    expect(onDenied).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// wrapPluginWithToolFilter — end-to-end factory wrapping.
// ---------------------------------------------------------------------------

function makePlugin(
  name: string,
  allowedTools: string[] | undefined,
  capture?: (ctx: IPluginContext) => void,
): IPlugin {
  return {
    manifest: {
      name,
      version: "0.0.1",
      capabilities: allowedTools === undefined ? undefined : { allowedTools },
    },
    factory: async (ctx: IPluginContext): Promise<PluginHooks> => {
      capture?.(ctx);
      return {};
    },
  };
}

describe("wrapPluginWithToolFilter — plugin wrapping", () => {
  it("plugin WITHOUT allowedTools: ctx.tools returns all tools (C46-4 default-permissive)", async () => {
    const tools = [makeTool("a"), makeTool("b")];
    let received: IPluginContext | undefined;
    const plugin = makePlugin("p", undefined, (ctx) => (received = ctx));
    const wrapped = wrapPluginWithToolFilter(plugin);

    // When allowedTools is undefined the plugin should be returned unchanged.
    expect(wrapped).toBe(plugin);

    await wrapped.factory(makeCtx(tools));
    expect(received!.tools!.list().map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("plugin WITH empty allowedTools array: treated as default-permissive (C46-4)", async () => {
    const tools = [makeTool("a"), makeTool("b")];
    let received: IPluginContext | undefined;
    const plugin = makePlugin("p", [], (ctx) => (received = ctx));
    const wrapped = wrapPluginWithToolFilter(plugin);
    // No wrapping should occur — empty allowedTools is the same as undefined.
    expect(wrapped).toBe(plugin);
    await wrapped.factory(makeCtx(tools));
    expect(received!.tools!.list().map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("plugin WITH allowedTools: Path A (manifest) → Path B (ctx.tools) filtered", async () => {
    const tools = [makeTool("fs:readFile"), makeTool("net:fetch")];
    let received: IPluginContext | undefined;
    const plugin = makePlugin("p", ["fs:readFile"], (ctx) => (received = ctx));

    // Rule #68 Path A: manifest carries the declaration.
    expect(plugin.manifest.capabilities?.allowedTools).toEqual(["fs:readFile"]);

    const wrapped = wrapPluginWithToolFilter(plugin);
    expect(wrapped).not.toBe(plugin);

    await wrapped.factory(makeCtx(tools));
    // Rule #68 Path B: ctx.tools accessor reflects the manifest declaration.
    expect(received!.tools!.list().map((t) => t.id)).toEqual(["fs:readFile"]);
    expect(received!.tools!.get("fs:readFile")?.id).toBe("fs:readFile");
    expect(received!.tools!.get("net:fetch")).toBeUndefined();
  });

  it("factory denial emits audit:capability_denied via onDenied callback", async () => {
    const tools = [makeTool("fs:readFile"), makeTool("net:fetch")];
    const events: ToolFilterAuditEvent[] = [];
    let received: IPluginContext | undefined;
    const plugin = makePlugin("plugin-x", ["fs:readFile"], (ctx) => (received = ctx));
    const wrapped = wrapPluginWithToolFilter(plugin, (e) => events.push(e));

    await wrapped.factory(makeCtx(tools));
    received!.tools!.get("net:fetch");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "audit:capability_denied",
      plugin: "plugin-x",
      tool: "net:fetch",
    });
  });

  it("preserves factory return value (hooks are returned unchanged)", async () => {
    const plugin: IPlugin = {
      manifest: { name: "p", version: "0.0.1", capabilities: { allowedTools: ["x"] } },
      factory: async () => ({ tools: [] }),
    };
    const wrapped = wrapPluginWithToolFilter(plugin);
    const hooks = await wrapped.factory(makeCtx([makeTool("x")]));
    expect(hooks).toEqual({ tools: [] });
  });

  it("handles missing ctx.tools gracefully (no crash, factory still invoked)", async () => {
    let received: IPluginContext | undefined;
    const plugin = makePlugin("p", ["anything"], (ctx) => (received = ctx));
    const wrapped = wrapPluginWithToolFilter(plugin);
    await wrapped.factory(makeCtx(undefined));
    expect(received).toBeDefined();
    expect(received!.tools).toBeUndefined();
  });
});
