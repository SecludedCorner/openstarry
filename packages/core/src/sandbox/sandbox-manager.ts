/**
 * PluginSandboxManager — spawns worker threads for sandboxed plugins.
 */

import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  IPlugin,
  IPluginContext,
  PluginHooks,
  ITool,
  ToolContext,
  EventBus,
  InputEvent,
  ISessionManager,
  IGuide,
  IProvider,
  IServiceRegistry,
  WorkerRestartPolicy,
  SandboxConfig,
} from "@openstarry/sdk";
import { AgentEventType, SandboxError } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";
import { z } from "zod";
import type {
  InitCompleteMessage,
  ToolResultMessage,
  SerializedPluginHooks,
} from "./messages.js";
import { createSignatureVerifier, type SignatureVerifier } from "./signature-verification.js";
import { attachRpcHandler, type SubscriptionState } from "./rpc-handler.js";
import { validatePluginImports } from "./import-analyzer.js";
import { createWorkerPool, type PluginWorkerPool } from "./worker-pool.js";
import { AuditLogger } from "./audit-logger.js";

const logger = createLogger("SandboxManager");

const DEFAULT_MEMORY_LIMIT_MB = 512;
const RPC_TIMEOUT_MS = 30000;
const DEFAULT_CPU_TIMEOUT_MS = 60000;
const HEARTBEAT_CHECK_INTERVAL_MS = 45000;
const DEFAULT_RESTART_POLICY: WorkerRestartPolicy = {
  maxRestarts: 3,
  backoffMs: 500,
  maxBackoffMs: 10000,
  resetWindowMs: 60000,
};

export interface WorkerResourceUsage {
  memoryUsageMb: number;
  cpuTimeMs: number;
}

interface SandboxedWorkerState {
  plugin: IPlugin;
  worker: Worker;
  hooks: PluginHooks;
  memoryLimitMb: number;
  rpcPendingRequests: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>;
  rpcCleanup: () => void;

  // Heartbeat monitoring
  lastHeartbeat: number;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  cpuTimeoutMs: number;

  // EventBus subscriptions (eventType -> Set<subscriptionId>)
  subscriptions: Map<string, Set<string>>;

  // Restart policy tracking
  crashCount: number;
  lastCrashTime: number;
  originalContext: IPluginContext;
  restartPolicy: WorkerRestartPolicy;
  isRestarting: boolean;

  // Audit logger (optional, created if config.auditLog.enabled)
  auditLogger?: AuditLogger;
}

export interface PluginSandboxManager {
  loadInSandbox(plugin: IPlugin, ctx: IPluginContext): Promise<PluginHooks>;
  invokeTool(
    pluginName: string,
    toolId: string,
    input: unknown,
    context: { workingDirectory: string; allowedPaths: string[] },
  ): Promise<string>;
  shutdownPlugin(pluginName: string): Promise<void>;
  shutdownAll(): Promise<void>;
  getResourceUsage(pluginName: string): Promise<WorkerResourceUsage | null>;
}

export interface SandboxManagerDeps {
  bus: EventBus;
  pushInput: (event: InputEvent) => void;
  sessions: ISessionManager;
  tools: {
    list(): ITool[];
    get(id: string): ITool | undefined;
  };
  guides: {
    list(): IGuide[];
  };
  providers: {
    list(): IProvider[];
    get(id: string): IProvider | undefined;
  };
  services?: IServiceRegistry;
  commands?: {
    list(): Array<{ name: string; description: string }>;
  };
  metrics?: {
    getSnapshot(): unknown;
  };
  /** Worker pool size. Default: OPENSTARRY_WORKER_POOL_SIZE env var or 4 */
  poolSize?: number;
}

/**
 * Resolve the worker runner script path.
 * After compilation, this file is at dist/sandbox/sandbox-manager.js,
 * and the worker runner is at dist/sandbox/plugin-worker-runner.js.
 */
function getWorkerRunnerPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return join(dirname(thisFile), "plugin-worker-runner.js");
}

export function createPluginSandboxManager(deps: SandboxManagerDeps): PluginSandboxManager {
  const workers = new Map<string, SandboxedWorkerState>();
  const verifier: SignatureVerifier = createSignatureVerifier();

  // Worker pool (lazy initialized)
  let workerPool: PluginWorkerPool | null = null;

  function ensurePoolInitialized(): PluginWorkerPool {
    if (!workerPool) {
      const poolSize = deps.poolSize ?? parseInt(process.env.OPENSTARRY_WORKER_POOL_SIZE || "4", 10);
      workerPool = createWorkerPool();
      void workerPool.initialize({
        poolSize,
        memoryLimitMb: DEFAULT_MEMORY_LIMIT_MB,
        workerScriptPath: getWorkerRunnerPath(),
      });
    }
    return workerPool;
  }

  let rpcIdCounter = 0;
  function nextRpcId(): string {
    return `main-rpc-${++rpcIdCounter}-${Date.now()}`;
  }

  function sendRpc(
    state: SandboxedWorkerState,
    type: string,
    payload: Record<string, unknown>,
    replyType: string,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextRpcId();
      const timer = setTimeout(() => {
        state.rpcPendingRequests.delete(id);
        reject(new SandboxError(
          state.plugin.manifest.name,
          `RPC timeout: ${type} (${id})`,
          { code: "SANDBOX_RPC_TIMEOUT" },
        ));
      }, RPC_TIMEOUT_MS);

      state.rpcPendingRequests.set(id, { resolve, reject, timeout: timer });

      function handler(msg: { type: string; replyTo?: string; payload?: unknown }) {
        if (msg.type === replyType && msg.replyTo === id) {
          clearTimeout(timer);
          state.rpcPendingRequests.delete(id);
          state.worker.off("message", handler);
          resolve(msg.payload);
        }
      }

      state.worker.on("message", handler);
      state.worker.postMessage({ type, id, payload });
    });
  }

  // ─── Heartbeat Monitoring ───

  function setupHeartbeatMonitor(state: SandboxedWorkerState, pluginName: string): void {
    state.lastHeartbeat = Date.now();

    // Listen for heartbeat messages to update timestamp
    const heartbeatHandler = (msg: { type: string; payload?: { timestamp?: number } }) => {
      if (msg.type === "HEARTBEAT") {
        state.lastHeartbeat = Date.now();
      }
    };
    state.worker.on("message", heartbeatHandler);

    // Periodically check if heartbeat is stale
    state.heartbeatTimer = setInterval(() => {
      const elapsed = Date.now() - state.lastHeartbeat;
      if (elapsed > state.cpuTimeoutMs) {
        logger.warn(`Worker stalled (no heartbeat for ${elapsed}ms): ${pluginName}`);
        deps.bus.emit({
          type: AgentEventType.SANDBOX_WORKER_STALLED,
          timestamp: Date.now(),
          payload: { pluginName, elapsedMs: elapsed, cpuTimeoutMs: state.cpuTimeoutMs },
        });
        clearInterval(state.heartbeatTimer);
        state.worker.off("message", heartbeatHandler);
        // Terminate stalled worker — will trigger crash handler for restart
        state.worker.terminate().catch(() => {});
      }
    }, HEARTBEAT_CHECK_INTERVAL_MS);
  }

  // ─── EventBus Forwarding ───

  let busForwardingSetup = false;

  function setupEventBusForwarding(): void {
    if (busForwardingSetup) return;
    busForwardingSetup = true;

    deps.bus.onAny((event) => {
      for (const [, state] of workers) {
        const hasSpecific = state.subscriptions.has(event.type);
        const hasWildcard = state.subscriptions.has("*");
        if (hasSpecific || hasWildcard) {
          try {
            state.worker.postMessage({
              type: "BUS_EVENT_DISPATCH",
              payload: {
                event: {
                  type: event.type,
                  timestamp: event.timestamp,
                  payload: event.payload,
                },
              },
            });
          } catch {
            // Worker may be terminating
          }
        }
      }
    });
  }

  // ─── Worker Restart ───

  async function handleWorkerCrash(
    state: SandboxedWorkerState,
    pluginName: string,
    error: string,
  ): Promise<void> {
    if (state.isRestarting) return;

    // Clean up heartbeat and subscriptions
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = undefined;
    }
    state.subscriptions.clear();

    // Emit crash event
    deps.bus.emit({
      type: AgentEventType.SANDBOX_WORKER_CRASHED,
      timestamp: Date.now(),
      payload: { pluginName, error },
    });

    // Cleanup pending RPCs
    for (const [, pending] of state.rpcPendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new SandboxError(pluginName, `Worker crashed: ${error}`));
    }
    state.rpcPendingRequests.clear();

    // Check reset window — if enough time has passed since last crash, reset count
    const policy = state.restartPolicy;
    if (state.lastCrashTime > 0 && Date.now() - state.lastCrashTime > policy.resetWindowMs) {
      state.crashCount = 0;
    }

    state.crashCount++;
    state.lastCrashTime = Date.now();

    // Check restart budget
    if (state.crashCount > policy.maxRestarts) {
      logger.error(`Worker restart budget exhausted for ${pluginName} (${state.crashCount}/${policy.maxRestarts})`);
      deps.bus.emit({
        type: AgentEventType.SANDBOX_WORKER_RESTART_EXHAUSTED,
        timestamp: Date.now(),
        payload: { pluginName, crashCount: state.crashCount, maxRestarts: policy.maxRestarts },
      });
      workers.delete(pluginName);
      return;
    }

    // Compute exponential backoff
    const backoff = Math.min(
      policy.backoffMs * Math.pow(2, state.crashCount - 1),
      policy.maxBackoffMs,
    );

    logger.info(`Restarting worker for ${pluginName} in ${backoff}ms (attempt ${state.crashCount}/${policy.maxRestarts})`);

    state.isRestarting = true;
    workers.delete(pluginName);

    // Wait for backoff
    await new Promise<void>((resolve) => setTimeout(resolve, backoff));

    try {
      // Re-load plugin in sandbox — this creates a fresh worker
      await manager.loadInSandbox(state.plugin, state.originalContext);

      // Transfer crash tracking to the new state
      const newState = workers.get(pluginName);
      if (newState) {
        newState.crashCount = state.crashCount;
        newState.lastCrashTime = state.lastCrashTime;
      }

      deps.bus.emit({
        type: AgentEventType.SANDBOX_WORKER_RESTARTED,
        timestamp: Date.now(),
        payload: { pluginName, attempt: state.crashCount, backoffMs: backoff },
      });

      logger.info(`Worker restarted successfully: ${pluginName}`);
    } catch (restartErr) {
      logger.error(`Failed to restart worker: ${pluginName}`, {
        error: restartErr instanceof Error ? restartErr.message : String(restartErr),
      });
      deps.bus.emit({
        type: AgentEventType.SANDBOX_WORKER_RESTART_EXHAUSTED,
        timestamp: Date.now(),
        payload: { pluginName, crashCount: state.crashCount, error: String(restartErr) },
      });
      workers.delete(pluginName);
    }
  }

  // ─── Manager implementation ───

  const manager: PluginSandboxManager = {
    async loadInSandbox(plugin: IPlugin, ctx: IPluginContext): Promise<PluginHooks> {
      const name = plugin.manifest.name;
      const sandboxConfig = plugin.manifest.sandbox;
      const memoryLimitMb = sandboxConfig?.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB;
      const cpuTimeoutMs = sandboxConfig?.cpuTimeoutMs ?? DEFAULT_CPU_TIMEOUT_MS;
      const restartPolicy = sandboxConfig?.restartPolicy ?? DEFAULT_RESTART_POLICY;

      logger.info(`Loading plugin in sandbox: ${name}`, { memoryLimitMb, cpuTimeoutMs });

      // Step 1: Signature verification (if integrity field present)
      // Note: ref.path is resolved at config level; PluginManifest doesn't carry it.
      // When ref.path is available in the load chain, verifier can be called.
      // For package-name plugins, we log a warning and continue.
      if (plugin.manifest.integrity) {
        logger.warn("Signature verification skipped for package-name plugin (no file path)", {
          plugin: name,
          integrity: typeof plugin.manifest.integrity === "string"
            ? plugin.manifest.integrity.slice(0, 16) + "..."
            : `PKI(${plugin.manifest.integrity.algorithm})`,
        });
      }

      // Step 1.5: Static import analysis (if file path available)
      // Package-name plugins don't have ref.path, so import analysis is skipped.
      // When ref.path is available in the plugin loading chain, this validates imports.
      const manifestAny = plugin.manifest as unknown as Record<string, unknown>;
      const pluginFilePath = manifestAny.ref
        ? (manifestAny.ref as { path?: string })?.path
        : undefined;

      if (pluginFilePath) {
        try {
          await validatePluginImports(pluginFilePath, {
            blockedModules: sandboxConfig?.blockedModules,
            allowedModules: sandboxConfig?.allowedModules,
          });
        } catch (err) {
          deps.bus.emit({
            type: AgentEventType.SANDBOX_IMPORT_BLOCKED,
            timestamp: Date.now(),
            payload: {
              pluginName: name,
              error: err instanceof Error ? err.message : String(err),
            },
          });
          throw new SandboxError(
            name,
            `Plugin import validation failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        logger.warn(`Cannot validate imports for package-name plugin: ${name} (no file path)`);
      }

      // Step 2: Acquire worker from pool or spawn new one
      let worker: Worker;
      const usePool = memoryLimitMb === DEFAULT_MEMORY_LIMIT_MB;

      if (usePool) {
        const pool = ensurePoolInitialized();
        worker = await pool.acquire(name);
        logger.info(`Acquired worker from pool for plugin: ${name}`);
      } else {
        worker = new Worker(getWorkerRunnerPath(), {
          resourceLimits: {
            maxOldGenerationSizeMb: memoryLimitMb,
          },
        });
        logger.info(`Spawned dedicated worker for plugin: ${name} (custom memory: ${memoryLimitMb}MB)`);
      }

      // Create AuditLogger if audit logging is enabled
      let auditLogger: AuditLogger | undefined;
      const auditConfig = sandboxConfig?.auditLog;
      if (auditConfig?.enabled) {
        const logDir = auditConfig.logDir ?? join(process.cwd(), "logs", "sandbox");
        auditLogger = new AuditLogger({
          pluginName: name,
          logDir,
          bufferSize: auditConfig.bufferSize,
          flushIntervalMs: auditConfig.flushIntervalMs,
          maxFileSizeMb: auditConfig.maxFileSizeMb,
          maxFiles: auditConfig.maxFiles,
          sanitizeArgs: auditConfig.sanitizeArgs,
          bus: deps.bus,
        });
        logger.info(`Audit logging enabled for plugin: ${name}`, { logDir });
      }

      const state: SandboxedWorkerState = {
        plugin,
        worker,
        hooks: {},
        memoryLimitMb,
        rpcPendingRequests: new Map(),
        rpcCleanup: () => {},
        lastHeartbeat: Date.now(),
        cpuTimeoutMs,
        subscriptions: new Map(),
        crashCount: 0,
        lastCrashTime: 0,
        originalContext: ctx,
        restartPolicy,
        isRestarting: false,
        auditLogger,
      };

      // Attach RPC handler for worker→main messages (bus, pushInput, sessions, subscriptions, etc.)
      const subscriptionState: SubscriptionState = { subscriptions: state.subscriptions };
      state.rpcCleanup = attachRpcHandler(worker, name, deps, subscriptionState, auditLogger);

      // Step 3: Setup heartbeat monitoring
      setupHeartbeatMonitor(state, name);

      // Step 4: Setup EventBus forwarding (once, globally)
      setupEventBusForwarding();

      // Step 5: Handle worker crash with restart logic
      worker.on("error", (err) => {
        logger.error(`Sandbox worker crashed: ${name}`, { error: String(err) });
        auditLogger?.logWorkerEvent("crash", {
          error: String(err),
          crashCount: state.crashCount + 1,
        });
        void handleWorkerCrash(state, name, err instanceof Error ? err.message : String(err));
      });

      worker.on("exit", (code) => {
        if (code !== 0 && !state.isRestarting) {
          logger.warn(`Sandbox worker exited with code ${code}: ${name}`);
          auditLogger?.logWorkerEvent("shutdown", { exitCode: code });
          const isMemoryLimit = code === 134 || code === null;
          if (isMemoryLimit) {
            deps.bus.emit({
              type: AgentEventType.SANDBOX_MEMORY_LIMIT_EXCEEDED,
              timestamp: Date.now(),
              payload: { pluginName: name, memoryLimitMb },
            });
          }
          void handleWorkerCrash(state, name, `Worker exited with code ${code}`);
        }
      });

      workers.set(name, state);

      deps.bus.emit({
        type: AgentEventType.SANDBOX_WORKER_SPAWNED,
        timestamp: Date.now(),
        payload: { pluginName: name, memoryLimitMb },
      });

      // Log worker spawn to audit trail
      auditLogger?.logWorkerEvent("spawn", {
        memoryLimitMb,
        cpuTimeoutMs,
        pooled: usePool,
      });

      // Step 6: Send INIT_PLUGIN and wait for INIT_COMPLETE
      // Include sandbox config so worker can apply moduleInterception setting
      const workerConfig = { ...ctx.config, sandbox: sandboxConfig };
      const initResult = await sendRpc(state, "INIT_PLUGIN", {
        pluginPath: (plugin as unknown as Record<string, unknown>)._resolvedModulePath ?? name,
        config: workerConfig,
        context: {
          workingDirectory: ctx.workingDirectory,
          agentId: ctx.agentId,
          config: workerConfig,
        },
      }, "INIT_COMPLETE") as InitCompleteMessage["payload"];

      if (!initResult.success) {
        await this.shutdownPlugin(name);
        throw new SandboxError(name, `Plugin initialization failed: ${initResult.error}`);
      }

      // Step 7: Create proxy hooks from serialized metadata
      const proxyHooks = createProxyHooks(name, initResult.hooks, state, this);
      state.hooks = proxyHooks;

      logger.info(`Plugin loaded in sandbox: ${name}`, {
        tools: initResult.hooks.tools?.length ?? 0,
        listeners: initResult.hooks.listeners?.length ?? 0,
        guides: initResult.hooks.guides?.length ?? 0,
      });

      return proxyHooks;
    },

    async invokeTool(
      pluginName: string,
      toolId: string,
      input: unknown,
      context: { workingDirectory: string; allowedPaths: string[] },
    ): Promise<string> {
      const state = workers.get(pluginName);
      if (!state) {
        throw new SandboxError(pluginName, "No sandbox worker found");
      }

      const startTime = Date.now();

      try {
        const result = await sendRpc(state, "INVOKE_TOOL", {
          toolId,
          input,
          context: {
            workingDirectory: context.workingDirectory,
            allowedPaths: context.allowedPaths,
          },
        }, "TOOL_RESULT") as ToolResultMessage["payload"];

        if (!result.success) {
          state.auditLogger?.logToolInvocation(
            toolId,
            input,
            "error",
            Date.now() - startTime,
            result.error,
          );
          throw new SandboxError(pluginName, `Tool "${toolId}" failed: ${result.error}`);
        }

        state.auditLogger?.logToolInvocation(
          toolId,
          input,
          "success",
          Date.now() - startTime,
        );

        return result.result ?? "";
      } catch (err) {
        if (!(err instanceof SandboxError)) {
          state.auditLogger?.logToolInvocation(
            toolId,
            input,
            "error",
            Date.now() - startTime,
            String(err),
          );
        }
        throw err;
      }
    },

    async shutdownPlugin(pluginName: string): Promise<void> {
      const state = workers.get(pluginName);
      if (!state) return;

      // Clear heartbeat monitor
      if (state.heartbeatTimer) {
        clearInterval(state.heartbeatTimer);
        state.heartbeatTimer = undefined;
      }

      // Clear subscriptions
      state.subscriptions.clear();

      // Mark as restarting to prevent crash handler from triggering
      state.isRestarting = true;

      // Return to pool if possible, otherwise terminate
      const usePool = state.memoryLimitMb === DEFAULT_MEMORY_LIMIT_MB;

      if (usePool && workerPool) {
        try {
          await workerPool.release(pluginName);
          logger.info(`Returned worker to pool: ${pluginName}`);
        } catch {
          // Pool release failed — terminate directly
          try {
            await state.worker.terminate();
          } catch {
            // Already terminated
          }
        }
      } else {
        try {
          state.worker.postMessage({ type: "SHUTDOWN" });
          await Promise.race([
            new Promise<void>((resolve) => {
              state.worker.once("exit", () => resolve());
            }),
            new Promise<void>((resolve) => setTimeout(resolve, 5000)),
          ]);
        } catch {
          // Force terminate
        }

        try {
          await state.worker.terminate();
        } catch {
          // Already terminated
        }
      }

      state.rpcCleanup();
      for (const [, pending] of state.rpcPendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new SandboxError(pluginName, "Worker shutdown"));
      }
      state.rpcPendingRequests.clear();

      // Dispose audit logger
      if (state.auditLogger) {
        state.auditLogger.logWorkerEvent("shutdown", { reason: "shutdownPlugin" });
        await state.auditLogger.dispose();
      }

      workers.delete(pluginName);

      deps.bus.emit({
        type: AgentEventType.SANDBOX_WORKER_SHUTDOWN,
        timestamp: Date.now(),
        payload: { pluginName },
      });

      logger.info(`Sandbox worker shutdown: ${pluginName}`);
    },

    async shutdownAll(): Promise<void> {
      const names = [...workers.keys()];
      await Promise.all(names.map((name) => this.shutdownPlugin(name)));

      // Shutdown idle workers in pool
      if (workerPool) {
        await workerPool.shutdown();
        workerPool = null;
      }
    },

    async getResourceUsage(pluginName: string): Promise<WorkerResourceUsage | null> {
      const state = workers.get(pluginName);
      if (!state) return null;

      try {
        const usage = state.worker.performance?.eventLoopUtilization?.();
        const heapUsed = state.worker.resourceLimits?.maxOldGenerationSizeMb ?? 0;
        return {
          memoryUsageMb: heapUsed,
          cpuTimeMs: usage ? usage.active : 0,
        };
      } catch {
        return null;
      }
    },
  };

  return manager;
}

/**
 * Create proxy PluginHooks from serialized hook metadata.
 * Each proxy hook forwards invocations to the sandbox worker via RPC.
 */
function createProxyHooks(
  pluginName: string,
  serialized: SerializedPluginHooks,
  _state: SandboxedWorkerState,
  manager: PluginSandboxManager,
): PluginHooks {
  const hooks: PluginHooks = {};

  if (serialized.tools && serialized.tools.length > 0) {
    hooks.tools = serialized.tools.map((t) => createProxyTool(pluginName, t, manager));
  }

  // Listeners from sandbox are metadata-only; actual event handling
  // stays in the worker. No proxy needed for MVP.

  // Commands from sandbox are proxied as string-based RPC.
  // Deferred to Plan07.1 for full command proxying.

  hooks.dispose = async () => {
    await manager.shutdownPlugin(pluginName);
  };

  return hooks;
}

/**
 * Create a proxy ITool that forwards execute() calls to the sandbox worker.
 */
function createProxyTool(
  pluginName: string,
  meta: { id: string; description: string },
  manager: PluginSandboxManager,
): ITool {
  return {
    id: meta.id,
    description: meta.description,
    // Accept any input — the worker will validate with its own Zod schema
    parameters: z.any(),
    async execute(input: unknown, ctx: ToolContext): Promise<string> {
      return manager.invokeTool(pluginName, meta.id, input, {
        workingDirectory: ctx.workingDirectory,
        allowedPaths: ctx.allowedPaths,
      });
    },
  };
}
