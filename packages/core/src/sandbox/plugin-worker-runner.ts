/**
 * Worker entry point — runs inside a worker_thread.
 * Loads a plugin, creates a context proxy, and handles RPC messages from main thread.
 */

// ─── Runtime Module._load interception (secondary defense layer) ───
// Install before any plugin code loads to catch ALL CommonJS imports of forbidden modules.
// Uses Module._load patching for comprehensive interception (replaces globalThis.require Proxy).
import Module from "node:module";

const RUNTIME_FORBIDDEN_MODULES = [
  "fs", "fs/promises", "child_process", "net", "dgram",
  "http", "https", "http2", "cluster", "worker_threads",
  "inspector", "v8",
];

let moduleInterceptionMode: "strict" | "warn" | "off" = "strict";

const originalLoad = (Module as any)._load;
(Module as any)._load = function(request: string, parent: any, isMain: boolean) {
  if (moduleInterceptionMode === "off") {
    return originalLoad.call(this, request, parent, isMain);
  }

  const normalized = request.replace(/^node:/, "");

  if (RUNTIME_FORBIDDEN_MODULES.includes(normalized)) {
    const parentFile = parent?.filename ?? "unknown";
    const errorMsg = `Sandbox security violation: Module "${request}" is forbidden (attempted by ${parentFile})`;

    console.error("[SANDBOX_MODULE_BLOCKED]", errorMsg);

    if (moduleInterceptionMode === "strict") {
      throw new Error(errorMsg);
    } else if (moduleInterceptionMode === "warn") {
      console.warn("[SANDBOX_MODULE_BLOCKED] Warning only, allowing load");
      return originalLoad.call(this, request, parent, isMain);
    }
  }

  return originalLoad.call(this, request, parent, isMain);
};

import { parentPort } from "node:worker_threads";
import type { IPlugin, ITool, PluginHooks, ToolContext, SandboxConfig } from "@openstarry/sdk";
import type {
  SandboxMessage,
  InitPluginMessage,
  InvokeToolMessage,
  SerializedPluginHooks,
} from "./messages.js";
import { createPluginContextProxy } from "./plugin-context-proxy.js";

if (!parentPort) {
  throw new Error("plugin-worker-runner must be run inside a worker_thread");
}

const port = parentPort;
let pluginHooks: PluginHooks | null = null;
let pluginName = "unknown";

/**
 * Dynamically import a plugin module and find the factory function.
 */
async function importPlugin(pluginPath: string): Promise<IPlugin> {
  const mod = await import(pluginPath) as Record<string, unknown>;

  // Try common export patterns: default, createPlugin, createXxxPlugin
  for (const key of Object.keys(mod)) {
    const val = mod[key];
    if (typeof val === "function") {
      const result = val();
      if (result && typeof result === "object" && "manifest" in result && "factory" in result) {
        return result as IPlugin;
      }
    }
  }

  // Try default export
  if (typeof mod.default === "function") {
    const result = (mod.default as () => unknown)();
    if (result && typeof result === "object" && "manifest" in result && "factory" in result) {
      return result as IPlugin;
    }
  }

  throw new Error(`Plugin module "${pluginPath}" does not export a valid factory function`);
}

/**
 * Serialize PluginHooks for transmission to main thread.
 */
function serializeHooks(hooks: PluginHooks): SerializedPluginHooks {
  return {
    tools: hooks.tools?.map((t) => ({ id: t.id, description: t.description })),
    providers: hooks.providers?.map((p) => ({ id: p.id, name: p.id })),
    listeners: hooks.listeners?.map((l) => ({ name: l.name })),
    ui: hooks.ui?.map((u) => ({ id: u.id })),
    guides: hooks.guides?.map((g) => ({ id: g.id, name: g.name })),
    commands: hooks.commands?.map((c) => ({ name: c.name, description: c.description })),
  };
}

/**
 * Handle INIT_PLUGIN message: load plugin and initialize it.
 */
async function handleInit(msg: InitPluginMessage): Promise<void> {
  try {
    // Apply moduleInterception config from sandbox config
    const sandboxCfg = msg.payload.config.sandbox as SandboxConfig | undefined;
    moduleInterceptionMode = sandboxCfg?.moduleInterception ?? "strict";

    const plugin = await importPlugin(msg.payload.pluginPath);
    pluginName = plugin.manifest.name;

    const ctx = createPluginContextProxy(port, msg.payload.context);
    // Override config from message
    Object.assign(ctx.config, msg.payload.config);

    pluginHooks = await plugin.factory(ctx);
    const serialized = serializeHooks(pluginHooks);

    port.postMessage({
      type: "INIT_COMPLETE",
      replyTo: msg.id,
      payload: { success: true, hooks: serialized },
    });
  } catch (err) {
    port.postMessage({
      type: "INIT_COMPLETE",
      replyTo: msg.id,
      payload: {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        hooks: {},
      },
    });
  }
}

/**
 * Handle INVOKE_TOOL message: find and execute the tool.
 */
async function handleInvokeTool(msg: InvokeToolMessage): Promise<void> {
  try {
    if (!pluginHooks?.tools) {
      throw new Error(`Plugin "${pluginName}" has no tools registered`);
    }

    const tool = pluginHooks.tools.find((t) => t.id === msg.payload.toolId) as ITool | undefined;
    if (!tool) {
      throw new Error(`Tool "${msg.payload.toolId}" not found in plugin "${pluginName}"`);
    }

    // Create a minimal ToolContext for the worker
    const toolCtx: ToolContext = {
      workingDirectory: msg.payload.context.workingDirectory,
      allowedPaths: msg.payload.context.allowedPaths,
      bus: createPluginContextProxy(port, {
        workingDirectory: msg.payload.context.workingDirectory,
        agentId: "",
        config: {},
      }).bus,
    };

    const input = tool.parameters.parse(msg.payload.input);
    const result = await tool.execute(input, toolCtx);

    port.postMessage({
      type: "TOOL_RESULT",
      replyTo: msg.id,
      payload: { success: true, result },
    });
  } catch (err) {
    port.postMessage({
      type: "TOOL_RESULT",
      replyTo: msg.id,
      payload: {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

/**
 * Handle RESET message: clear plugin state and return to idle.
 */
async function handleReset(): Promise<void> {
  // Dispose plugin hooks (best-effort)
  if (pluginHooks?.dispose) {
    try {
      await pluginHooks.dispose();
    } catch {
      // Best-effort cleanup
    }
  }

  // Clear plugin state
  pluginHooks = null;
  pluginName = "unknown";

  // Acknowledge reset complete
  port.postMessage({ type: "RESET_COMPLETE" });
}

/**
 * Handle SHUTDOWN message: cleanup and exit.
 */
async function handleShutdown(): Promise<void> {
  if (pluginHooks?.dispose) {
    try {
      await pluginHooks.dispose();
    } catch {
      // Best-effort cleanup
    }
  }
  process.exit(0);
}

// ─── Message Loop ───

port.on("message", (msg: SandboxMessage) => {
  if (!msg || typeof msg.type !== "string") return;

  switch (msg.type) {
    case "INIT_PLUGIN":
      handleInit(msg).catch((err) => {
        port.postMessage({
          type: "INIT_COMPLETE",
          replyTo: msg.id,
          payload: {
            success: false,
            error: String(err),
            hooks: {},
          },
        });
      });
      break;
    case "INVOKE_TOOL":
      handleInvokeTool(msg).catch((err) => {
        port.postMessage({
          type: "TOOL_RESULT",
          replyTo: msg.id,
          payload: {
            success: false,
            error: String(err),
          },
        });
      });
      break;
    case "RESET":
      handleReset().catch(() => {
        port.postMessage({ type: "RESET_COMPLETE" });
      });
      break;
    case "SHUTDOWN":
      handleShutdown().catch(() => process.exit(1));
      break;
    default:
      break;
  }
});

// Send heartbeat periodically
const heartbeatInterval = setInterval(() => {
  port.postMessage({
    type: "HEARTBEAT",
    payload: { timestamp: Date.now() },
  });
}, 30000);

// Don't let heartbeat keep the worker alive
heartbeatInterval.unref();
