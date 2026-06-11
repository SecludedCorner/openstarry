/**
 * tool-filter-proxy — Plan46 W1 runtime enforcement of PluginCapabilities.allowedTools.
 *
 * Wraps a plugin's factory so that `ctx.tools` exposes only the tool IDs listed
 * in `manifest.capabilities.allowedTools`. Blocked `get(id)` calls return
 * undefined and (optionally) emit an audit:capability_denied event.
 *
 * Design tenets:
 *   - C46-1 Zero Core modifications — filtering is enforced in the runner layer.
 *   - C46-4 Default permissive — if `allowedTools` is undefined or empty the
 *     plugin is returned unchanged and sees the full tool registry.
 *   - Tenet #2 Everything is a Plugin — the Core tool registry is untouched.
 *   - Rule #68 Two-path — manifest config (Path A) yields the filtered accessor
 *     that the factory receives at runtime (Path B) via ctx.tools.
 */

import type { IPlugin, IPluginContext, ITool, PluginHooks } from "@openstarry/sdk";

/**
 * Hook-capture wrapper (Plan46 W2) — records each plugin's PluginHooks return
 * value into `hookMap` keyed by manifest name so the runner can hand the map
 * to the CheckpointManager. The live hook references are required because
 * core.loadPlugin() returns Promise<void> and does not expose hooks.
 */
export function capturePluginHooks(
  plugin: IPlugin,
  hookMap: Map<string, PluginHooks>,
): IPlugin {
  return {
    manifest: plugin.manifest,
    factory: async (ctx: IPluginContext): Promise<PluginHooks> => {
      const hooks = await plugin.factory(ctx);
      if (hooks.onCheckpoint || hooks.onRestore) {
        hookMap.set(plugin.manifest.name, hooks);
      }
      return hooks;
    },
  };
}

export interface ToolFilterAuditEvent {
  readonly type: "audit:capability_denied";
  readonly plugin: string;
  readonly tool: string;
  readonly allowedTools: readonly string[];
  readonly timestamp: string;
}

export interface ToolRegistryAccessor {
  list(): ITool[];
  get(id: string): ITool | undefined;
}

/**
 * Build a filtered view of a tool registry accessor. `list()` excludes any
 * tool whose id is not in `allowedTools`; `get(id)` returns undefined for
 * blocked ids and invokes `onDenied` with a structured audit event.
 */
export function createToolFilterProxy(
  tools: ToolRegistryAccessor,
  allowedTools: readonly string[],
  pluginName: string,
  onDenied?: (event: ToolFilterAuditEvent) => void,
): ToolRegistryAccessor {
  const allowedSet = new Set(allowedTools);
  return {
    list: () => tools.list().filter((t) => allowedSet.has(t.id)),
    get: (id: string) => {
      if (!allowedSet.has(id)) {
        onDenied?.({
          type: "audit:capability_denied",
          plugin: pluginName,
          tool: id,
          allowedTools: [...allowedTools],
          timestamp: new Date().toISOString(),
        });
        return undefined;
      }
      return tools.get(id);
    },
  };
}

/**
 * Wrap an IPlugin so its factory sees a filtered ctx.tools.
 *
 * Returns the original plugin unchanged when `allowedTools` is undefined or
 * empty (C46-4 default-permissive). Preserves the manifest reference so
 * other subsystems (loader, integrity check) are unaffected.
 */
export function wrapPluginWithToolFilter(
  plugin: IPlugin,
  onDenied?: (event: ToolFilterAuditEvent) => void,
): IPlugin {
  const allowedTools = plugin.manifest.capabilities?.allowedTools;
  if (!allowedTools || allowedTools.length === 0) return plugin;

  const pluginName = plugin.manifest.name;

  return {
    manifest: plugin.manifest,
    factory: async (ctx: IPluginContext): Promise<PluginHooks> => {
      const filteredCtx: IPluginContext = ctx.tools
        ? { ...ctx, tools: createToolFilterProxy(ctx.tools, allowedTools, pluginName, onDenied) }
        : ctx;
      return plugin.factory(filteredCtx);
    },
  };
}
