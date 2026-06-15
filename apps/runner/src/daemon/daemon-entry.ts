#!/usr/bin/env node

/**
 * Daemon Entry Point — Runs inside the daemon process.
 *
 * Responsibilities:
 * - Parse daemon CLI args
 * - Write PID file
 * - Load agent config
 * - Create and start agent core
 * - Start IPC server
 * - Handle shutdown signals
 */

import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { Socket } from "node:net";
import type { IAgentConfig, InputEvent, ISeed, IDaemonSpawnService } from "@openstarry/sdk";
import { DEFAULT_AGENT_GRACE_PERIOD_MS, MAX_AGENT_GRACE_PERIOD_MS, SERVICE_KEYS, SpawnDeniedError } from "@openstarry/sdk";
import { createAgentCore, isPathSafe } from "@openstarry/core";
import { validateSpawnConstraints, computeAgentDepth } from "./spawn-validator.js";
import { PermissionLattice } from "./permission-lattice.js";
import { DualRateLimiter } from "./rate-limiter.js";
import { RateLimitError } from "@openstarry/sdk";
import { parseArgs } from "../utils/args.js";
import { validateConfig } from "../utils/config-validator.js";
import { resolvePlugins } from "../utils/plugin-resolver.js";
import { IPCServerImpl } from "./ipc-server.js";
import { pidManager } from "./pid-manager.js";
import type { RPCRequest, AgentStatus, AttachOptions, AttachResult, InputMessage, DetachMessage, ListClientsResult, ClientInfo, ChildAgentSpawnConfig, AgentRegistryEntry, ProcessTreeNode, AgentLifecycleStatus, IDaemonControlPlane } from "./types.js";
import { RPCErrorCode, Plan37RPCErrorCode } from "./types.js";
import { spawnDaemon } from "./launcher.js";
import { initEventForwarder } from "./event-forwarder.js";
import { FileSessionPersistence } from "./session-persistence.js";
import { SESSIONS_DIR, OPENSTARRY_HOME } from "../bootstrap.js";
import { MessageRouter } from "./message-router.js";
import { EventBridge } from "./event-bridge.js";
import { GlobalServiceRegistry } from "./global-service-registry.js";
import { verifyAgentIdentity, removePidIdentity } from "./pid-identity.js";

/**
 * Daemon context holds all daemon state.
 */
interface DaemonContext {
  agentId: string;
  config: IAgentConfig;
  configPath: string;
  pidFile: string;
  socketPath: string;
  logFile: string;
  core: ReturnType<typeof createAgentCore>;
  ipcServer: IPCServerImpl;
  startTime: number;
  persistence: FileSessionPersistence;
  cleanupInterval: NodeJS.Timeout | null;
  /** Cluster-wide HMAC key (hex). Generated once at daemon startup. MUST NOT be logged. */
  hmacKeyHex: string;
}

let ctx: DaemonContext | null = null;
let shuttingDown = false;
let eventForwarderUnsub: (() => void) | null = null;

/**
 * In-memory process tree registry.
 * Maps agentId -> AgentRegistryEntry.
 * Plan37 C8: stub implementation for process tree tracking.
 */
const agentRegistry = new Map<string, AgentRegistryEntry>();

/**
 * MessageRouter — capability enforcement for inter-agent messaging.
 * Plan37 C11: fail-closed capability-based access control.
 */
const messageRouter = new MessageRouter();

/**
 * DualRateLimiter for inbound agent.input. GAP-2026-06-15: DualRateLimiter.check
 * previously had only test callers — the daemon never throttled any inbound
 * message despite the header's "both layers must be enforced" claim. Keyed by
 * this daemon's agentId (per-agent total) + sessionId (per-target/per-session),
 * using SDK DEFAULT_* limits (100/agent, 20/session per 1000ms window).
 */
const inputRateLimiter = new DualRateLimiter();

/** Server-defined JSON-RPC error code (−32000..−32099 reserved) for rate limiting. */
const RATE_LIMITED_RPC_CODE = -32005;

/**
 * EventBridge — cross-agent event forwarding service.
 * Plan37 C12: fail-open observational component.
 */
const eventBridge = new EventBridge();

/**
 * GlobalServiceRegistry — L2 daemon-level service discovery.
 * Plan37 C13: DNS-model registry for cross-agent service lookup.
 */
const globalServiceRegistry = new GlobalServiceRegistry();

/**
 * Per-agent lifecycle status map.
 * Plan37 C14: tracks graceful shutdown states.
 */
const agentStatuses = new Map<string, AgentLifecycleStatus>();

/**
 * Per-agent grace period override cache.
 * Populated at spawn time from IAgentConfig.communication.gracePeriodMs.
 * Allows gracefulStopAgent() to honour per-agent configuration without
 * re-reading disk at shutdown time.
 */
const agentGracePeriods = new Map<string, number>();

/**
 * SEC-002 (Plan38 C1): PID-to-agentId identity mapping.
 * Populated at spawn time. Used to verify caller identity on sensitive operations.
 * MECHANISM: fail-closed — PID mismatch rejects the operation.
 */
const pidToAgentMap = new Map<number, string>();

/**
 * Main entry point for daemon process.
 */
async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  // Extract daemon args
  const agentId = parsed.flags["agent-id"] as string;
  const configPath = parsed.flags.config as string;
  const pidFile = parsed.flags["pid-file"] as string;
  const socketPath = parsed.flags.socket as string;
  const logFile = parsed.flags["log-file"] as string;

  if (!agentId || !configPath || !pidFile || !socketPath || !logFile) {
    console.error("[daemon] Missing required arguments");
    process.exit(1);
  }

  console.error(`[daemon] Starting daemon for agent: ${agentId}`);
  console.error(`[daemon]   Config: ${configPath}`);
  console.error(`[daemon]   PID file: ${pidFile}`);
  console.error(`[daemon]   Socket: ${socketPath}`);
  console.error(`[daemon]   Log: ${logFile}`);

  try {
    // 1. Write PID file
    pidManager.writePid(pidFile, process.pid);
    console.error(`[daemon] PID ${process.pid} written to ${pidFile}`);

    // 2. Load and validate config
    const config = await loadConfig(configPath);
    console.error(`[daemon] Config loaded and validated`);

    // 3. Create agent core
    const core = createAgentCore(config);
    console.error(`[daemon] Agent core created`);

    // 3.5 Cluster-wide HMAC key (Plan40 W3-C, HMAC Option A) — TENET-2026-06-11:
    // read MOVED BEFORE plugin loading so the key can be injected into the
    // distributed-alaya plugin ref. Until this change, DaemonKeyProvider's
    // "Daemon-distributed cluster-wide key" was in-name-only: the daemon
    // generated/forwarded the key to child daemons but never injected it into
    // the plugin, so two processes never shared a key unless hand-written
    // into config files. Env is deleted immediately after read, BEFORE any
    // plugin factory runs (SEC: plugins never see the raw env; HMAC-F1).
    // SECURITY: never log this value — not even at debug level.
    const hmacKeyHex = process.env['OPENSTARRY_HMAC_KEY'] ?? randomBytes(32).toString('hex');
    delete process.env['OPENSTARRY_HMAC_KEY'];
    for (const ref of config.plugins) {
      if (ref.name === '@openstarry-plugin/distributed-alaya') {
        // Injected defaults; explicit config-file values win.
        ref.config = { agentId, hmacKeyHex, ...(ref.config ?? {}) };
      }
    }

    // 3.6 Register the runtime spawn service (ledger #10) BEFORE plugins load,
    // so the agent-spawn plugin's agent.spawnChild ITool can consume it via
    // SERVICE_KEYS.DAEMON_SPAWN. Backed by handleSpawnChild — the same path that
    // enforces the F-5 permission lattice (depth/budget/ceiling, A②) + SEC-003.
    // parentId is THIS daemon's own agent (self-registered in the process tree),
    // so an LLM-initiated spawn is a genuine child of the running agent. Only the
    // daemon registers this; in foreground/CLI mode it is absent and the tool
    // reports a clear daemon-only error.
    const spawnService: IDaemonSpawnService = {
      name: "daemon-spawn",
      version: "1.0.0",
      async spawnChild(input) {
        const result = await handleSpawnChild({
          parentId: agentId,
          childConfig: {
            agentId: input.agentId,
            configPath: input.configPath,
            statePath: input.statePath ?? OPENSTARRY_HOME,
          },
        });
        return { pid: result.pid, agentId: result.agentId };
      },
    };
    core.serviceRegistry.register(spawnService);

    // 4. Load plugins
    const pluginResult = await resolvePlugins(config, false, null);
    for (const plugin of pluginResult.plugins) {
      await core.loadPlugin(plugin);
    }
    console.error(`[daemon] ${pluginResult.plugins.length} plugin(s) loaded`);

    // 5. Create IPC server (pass socket to handler for session subscription)
    const ipcServer = new IPCServerImpl({
      socketPath,
      onRequest: (req, socket) => handleRPCRequest(req, socket),
    });

    // 6. Create session persistence
    const persistence = new FileSessionPersistence(
      SESSIONS_DIR,
      config.session?.persistence?.maxHistorySize ?? 1000
    );
    console.error(`[daemon] Session persistence initialized`);

    // 7. Setup signal handlers BEFORE starting anything
    // (hmacKeyHex now read at step 3.5, before plugin loading — TENET-2026-06-11)
    const startTime = Date.now();
    ctx = {
      agentId,
      config,
      configPath,
      pidFile,
      socketPath,
      logFile,
      core,
      ipcServer,
      startTime,
      persistence,
      cleanupInterval: null,
      hmacKeyHex,
    };

    process.on("SIGTERM", () => shutdownWithTimeout("SIGTERM"));
    process.on("SIGINT", () => shutdownWithTimeout("SIGINT"));
    if (process.platform !== "win32") {
      process.on("SIGHUP", () => shutdownWithTimeout("SIGHUP"));
    }

    // 8. Start IPC server
    await ipcServer.start();
    console.error(`[daemon] IPC server listening on ${socketPath}`);

    // 9. Start agent core
    await core.start();
    console.error(`[daemon] Agent core started`);

    // 9.5 GAP-2026-06-11 (T3b): self-register the ROOT agent. Until this
    // change the root was never inserted into agentRegistry, so on a real
    // daemon `agent.processTree` returned [] and `agent.childAgents` always
    // came back empty (parent entry undefined at spawn bookkeeping) — the
    // process tree was hollow in the live path.
    agentRegistry.set(agentId, {
      agentId,
      pid: process.pid,
      status: 'running',
      configPath,
      socketPath,
      logFile,
      uptime: 0,
      childAgentIds: [],
    });
    agentStatuses.set(agentId, 'running');
    pidToAgentMap.set(process.pid, agentId);
    messageRouter.registerAgent(agentId, {
      canSendTo: config.communication?.canSendTo ?? [],
      canReceiveFrom: config.communication?.canReceiveFrom ?? [],
      exposedTools: config.communication?.exposedTools ?? [],
    });
    console.error(`[daemon] Root agent registered in process tree`);

    // 10. Initialize event forwarder (bridge core.bus to IPC)
    eventForwarderUnsub = initEventForwarder(core.bus, ipcServer, agentId);
    console.error(`[daemon] Event forwarder initialized`);

    // 11. Start cleanup task (every 1 hour)
    const idleTTL = config.session?.persistence?.idleTTL ?? 86400;
    ctx.cleanupInterval = setInterval(() => {
      persistence.cleanupExpired(agentId, idleTTL)
        .then((count) => {
          if (count > 0) {
            console.error(`[daemon] Cleaned up ${count} expired session(s)`);
          }
        })
        .catch((err) => {
          console.error(`[daemon] Session cleanup failed: ${err}`);
        });
    }, 3600000); // 1 hour
    console.error(`[daemon] Session cleanup task started (TTL: ${idleTTL}s)`);

    console.error(`[daemon] Daemon fully initialized and running`);

  } catch (err) {
    console.error(`[daemon] Startup failed: ${err}`);
    process.exit(1);
  }
}

/**
 * Load and validate agent configuration.
 */
async function loadConfig(configPath: string): Promise<IAgentConfig> {
  const raw = await readFile(configPath, "utf-8");
  const json: unknown = JSON.parse(raw);

  const validation = validateConfig(json as IAgentConfig);
  if (!validation.valid) {
    const errors = validation.errors!.map(e => `${e.path}: ${e.message}`).join(", ");
    throw new Error(`Config validation failed: ${errors}`);
  }

  return validation.config!;
}

/**
 * Handle RPC requests from IPC clients.
 */
async function handleRPCRequest(req: RPCRequest, socket: Socket): Promise<unknown> {
  if (!ctx) {
    throw new Error("Daemon context not initialized");
  }

  switch (req.method) {
    case "agent.ping":
      return { pong: true };

    case "agent.status":
      return getAgentStatus();

    case "agent.stop":
      // Initiate graceful shutdown
      setImmediate(() => shutdown("RPC"));
      return { success: true };

    case "daemon.health":
      return {
        uptime: Math.floor((Date.now() - ctx.startTime) / 1000),
        version: ctx.config.identity.version,
      };

    case "agent.attach":
      return handleAttach(req.params as AttachOptions | undefined, socket);

    case "agent.input":
      return handleInput(req.params as InputMessage);

    case "agent.detach":
      return handleDetach(req.params as DetachMessage, socket);

    case "agent.list-clients":
      return handleListClients();

    case "agent.spawnChild":
      return handleSpawnChild(req.params as { parentId: string; childConfig: ChildAgentSpawnConfig });

    case "agent.processTree":
      return handleProcessTree();

    case "agent.childAgents":
      return handleChildAgents(req.params as { parentId: string });

    case "service.register": {
      const p = req.params as { serviceName: string; agentId: string; pid?: number; metadata?: Record<string, unknown> };
      // SEC-002 (Plan38 C1): Verify caller identity before allowing service registration.
      // If caller provides pid, it must match the expected agentId in pidToAgentMap (fail-closed).
      if (p.pid !== undefined && !verifyAgentIdentity(p.pid, p.agentId, pidToAgentMap)) {
        throw {
          code: RPCErrorCode.INVALID_PARAMS,
          message: `SEC-002: PID ${p.pid} is not the registered owner of agentId "${p.agentId}"`,
        };
      }
      globalServiceRegistry.register(p.serviceName, p.agentId, p.metadata);
      return { success: true };
    }

    case "service.lookup": {
      const p = req.params as { serviceName: string };
      return globalServiceRegistry.lookup(p.serviceName);
    }

    case "service.list":
      return globalServiceRegistry.listAll();

    case "eventbridge.subscribe": {
      const p = req.params as { agentId: string; eventSubscriptions: string[] };
      eventBridge.registerAgent(p.agentId, p.eventSubscriptions);
      return { success: true };
    }

    // ─── TENET-2026-06-11: alaya cross-process surface (宣言 #6) ───
    // alaya.acceptSeed is the RECEIVER side of cross-process seed
    // propagation: a peer daemon's IpcRemotePeer delivers a signed seed
    // here; DistributedAlayaImpl.acceptRemote() independently verifies the
    // HMAC with THIS process's cluster-key copy before the store is touched.
    // plant/propagate/query form the control plane so operators and e2e
    // tests can drive the alaya without an LLM turn. All fail-closed when
    // the plugin is absent.

    case "alaya.acceptSeed": {
      const raw = JSON.stringify(req.params ?? {});
      if (raw.length > 100_000) {
        throw { code: RPCErrorCode.INVALID_PARAMS, message: "alaya.acceptSeed: payload exceeds 100KB" };
      }
      const p = req.params as { seed: ISeed; vectorClock: Record<string, number>; fromAgentId?: string };
      if (!p || typeof p.seed !== "object" || p.seed === null || typeof p.vectorClock !== "object" || p.vectorClock === null) {
        throw { code: RPCErrorCode.INVALID_PARAMS, message: "alaya.acceptSeed: seed and vectorClock are required" };
      }
      const alaya = getAlayaService();
      await alaya.acceptRemote(p.seed, p.vectorClock);
      return { accepted: true, seedId: p.seed.seedId };
    }

    case "alaya.plant": {
      const p = req.params as { seed: ISeed };
      if (!p || typeof p.seed !== "object" || p.seed === null) {
        throw { code: RPCErrorCode.INVALID_PARAMS, message: "alaya.plant: seed is required" };
      }
      const alaya = getAlayaService();
      await alaya.plant(p.seed);
      return { planted: true, seedId: p.seed.seedId };
    }

    case "alaya.propagate": {
      const p = req.params as { seedId: string; targets: string[] };
      if (!p || typeof p.seedId !== "string" || !Array.isArray(p.targets)) {
        throw { code: RPCErrorCode.INVALID_PARAMS, message: "alaya.propagate: seedId and targets[] are required" };
      }
      const alaya = getAlayaService();
      await alaya.propagate(p.seedId, p.targets);
      return { propagated: true };
    }

    case "alaya.query": {
      const p = (req.params ?? {}) as { filter?: Record<string, unknown> };
      const alaya = getAlayaService();
      const seeds = await alaya.query(p.filter ?? {});
      return { seeds };
    }

    default:
      throw {
        code: RPCErrorCode.METHOD_NOT_FOUND,
        message: `Unknown method: ${req.method}`,
      };
  }
}

/**
 * Resolve the distributed-alaya runtime from the core service registry
 * (TENET-2026-06-11). The registered service is a wrapper exposing
 * getDistributedAlaya() (plugin index.ts) — NOT the IDistributedAlaya the
 * ServiceKey type claims (pre-existing type lie, handled structurally).
 * acceptRemote/plant/propagate/query are duck-typed because the daemon must
 * not import plugin implementation classes (layering). Fail-closed when the
 * plugin is absent.
 */
function getAlayaService(): {
  acceptRemote(seed: ISeed, vectorClock: Record<string, number>): Promise<void>;
  plant(seed: ISeed): Promise<void>;
  propagate(seedId: string, targets: string[]): Promise<void>;
  query(filter: Record<string, unknown>): Promise<ISeed[]>;
} {
  if (!ctx) {
    throw new Error("Daemon context not initialized");
  }
  const wrapper = ctx.core.serviceRegistry.get(SERVICE_KEYS.DISTRIBUTED_ALAYA) as
    | { getDistributedAlaya?: () => unknown }
    | undefined;
  const alaya = wrapper?.getDistributedAlaya?.();
  if (!alaya || typeof (alaya as { acceptRemote?: unknown }).acceptRemote !== "function") {
    throw {
      code: RPCErrorCode.INVALID_PARAMS,
      message: "alaya.*: @openstarry-plugin/distributed-alaya is not loaded on this agent (fail-closed)",
    };
  }
  return alaya as ReturnType<typeof getAlayaService>;
}

/**
 * Handle agent.attach RPC — create/join session and subscribe client.
 */
async function handleAttach(
  options: AttachOptions | undefined,
  socket: Socket,
): Promise<AttachResult> {
  if (!ctx) {
    throw new Error("Daemon context not initialized");
  }

  let sessionId: string;
  let isNew: boolean;

  if (options?.sessionId) {
    // Try to join existing session
    sessionId = options.sessionId;
    let existing = ctx.core.sessionManager.get(sessionId);

    // If not in memory, try to load from disk
    if (!existing) {
      const persisted = await ctx.persistence.load(ctx.agentId, sessionId);
      if (persisted) {
        // Restore session from disk
        const stateManager = ctx.core.sessionManager.getStateManager(sessionId);
        stateManager.restore(persisted.messages);

        // Recreate session in memory
        const restored = ctx.core.sessionManager.create(persisted.session.metadata);
        sessionId = restored.id;
        existing = restored;

        console.error(`[daemon] Restored session ${sessionId} from disk (${persisted.messages.length} messages)`);
      }
    }

    if (!existing) {
      throw {
        code: RPCErrorCode.INVALID_PARAMS,
        message: `Session '${sessionId}' not found. Omit sessionId to create a new session.`,
      };
    }

    isNew = false;
  } else {
    // Create new session
    const newSession = ctx.core.sessionManager.create();
    sessionId = newSession.id;
    isNew = true;
  }

  // Subscribe client socket to session events
  ctx.ipcServer.subscribeSession(socket, sessionId);

  // Replay history for existing sessions
  if (!isNew) {
    const replayCount = ctx.config.session?.replayCount ?? 50;
    await replayHistory(socket, sessionId, replayCount);
  }

  return {
    sessionId,
    isNew,
    agentId: ctx.agentId,
    agentName: ctx.config.identity.name,
    agentVersion: ctx.config.identity.version ?? "unknown",
  };
}

/**
 * Handle agent.input RPC — forward input to core.
 */
async function handleInput(msg: InputMessage): Promise<{ success: boolean }> {
  if (!ctx) {
    throw new Error("Daemon context not initialized");
  }

  if (!msg || !msg.sessionId || !msg.inputType || msg.data === undefined) {
    throw {
      code: RPCErrorCode.INVALID_PARAMS,
      message: "Invalid InputMessage: sessionId, inputType, and data are required",
    };
  }

  // Validate sessionId format (alphanumeric, underscore, hyphen, max 64 chars)
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(msg.sessionId)) {
    throw {
      code: RPCErrorCode.INVALID_PARAMS,
      message: "Invalid sessionId format (must be alphanumeric, underscore, or hyphen, max 64 chars)",
    };
  }

  // Validate inputType whitelist
  const ALLOWED_INPUT_TYPES = ["user_input", "slash_command"];
  if (!ALLOWED_INPUT_TYPES.includes(msg.inputType)) {
    throw {
      code: RPCErrorCode.INVALID_PARAMS,
      message: `Invalid inputType '${msg.inputType}' (allowed: ${ALLOWED_INPUT_TYPES.join(", ")})`,
    };
  }

  // Validate data size (max 100KB)
  const dataSize = JSON.stringify(msg.data).length;
  if (dataSize > 100 * 1024) {
    throw {
      code: RPCErrorCode.INVALID_PARAMS,
      message: `Input data exceeds max size of 100KB (got ${dataSize} bytes)`,
    };
  }

  // Rate limit (GAP-2026-06-15): per-agent total + per-session throttle, fail-closed.
  try {
    inputRateLimiter.check(ctx.agentId, msg.sessionId);
  } catch (err: unknown) {
    if (err instanceof RateLimitError) {
      throw {
        code: RATE_LIMITED_RPC_CODE,
        message: err.message,
        data: { code: 'RATE_LIMITED', scope: err.limitType, sessionId: msg.sessionId },
      };
    }
    throw err;
  }

  const inputEvent: InputEvent = {
    source: "attach",
    inputType: msg.inputType,
    data: msg.data,
    sessionId: msg.sessionId,
  };

  ctx.core.pushInput(inputEvent);

  // Save session to disk (debounced)
  const session = ctx.core.sessionManager.get(msg.sessionId);
  if (session) {
    const stateManager = ctx.core.sessionManager.getStateManager(msg.sessionId);
    const messages = stateManager.getMessages();
    await ctx.persistence.save(ctx.agentId, session, messages);
  }

  return { success: true };
}

/**
 * Replay conversation history to newly attached client.
 */
async function replayHistory(socket: Socket, sessionId: string, maxMessages: number): Promise<void> {
  if (!ctx) return;

  try {
    const stateManager = ctx.core.sessionManager.getStateManager(sessionId);
    const messages = stateManager.getMessages();
    const replayMessages = messages.slice(-maxMessages);

    if (replayMessages.length === 0) {
      return;
    }

    console.error(`[daemon] Replaying ${replayMessages.length} messages to client`);

    for (const msg of replayMessages) {
      const replayEvent = {
        event: "agent.replay",
        data: {
          sessionId,
          message: msg,
        },
      };

      socket.write(JSON.stringify(replayEvent) + "\n");
    }
  } catch (err) {
    console.error(`[daemon] History replay failed: ${err}`);
  }
}

/**
 * Handle agent.list-clients RPC — return list of connected clients.
 */
function handleListClients(): ListClientsResult {
  if (!ctx) {
    throw new Error("Daemon context not initialized");
  }

  const clients: ClientInfo[] = [];
  for (const [socket, metadata] of ctx.ipcServer.clientMetadata.entries()) {
    if (!socket.destroyed) {
      clients.push({
        clientId: metadata.clientId,
        attachedAt: metadata.attachedAt,
        sessionId: metadata.sessionId,
      });
    }
  }

  return { clients };
}

/**
 * Handle agent.detach RPC — unsubscribe client from session.
 */
async function handleDetach(
  msg: DetachMessage,
  socket: Socket,
): Promise<{ success: boolean }> {
  if (!ctx) {
    throw new Error("Daemon context not initialized");
  }

  if (!msg || !msg.sessionId) {
    throw {
      code: RPCErrorCode.INVALID_PARAMS,
      message: "Invalid DetachMessage: sessionId is required",
    };
  }

  ctx.ipcServer.unsubscribeSession(socket, msg.sessionId);

  return { success: true };
}

/**
 * Handle agent.spawnChild RPC — spawn a child daemon under a parent agent.
 * Implements permission lattice validation (fail-closed, Rule #35).
 */
async function handleSpawnChild(
  params: { parentId: string; childConfig: ChildAgentSpawnConfig }
): Promise<import("./types.js").DaemonSpawnResult> {
  // SEC-001: Daemon-level drain-evasion guard. Reject spawn if the daemon itself
  // is shutting down (between SIGTERM receipt and ipcServer.stop()).
  if (shuttingDown) {
    throw { code: Plan37RPCErrorCode.PARENT_DRAINING, message: 'Daemon is shutting down — spawn denied' };
  }

  if (!ctx) {
    throw new Error("Daemon context not initialized");
  }

  if (!params || !params.parentId || !params.childConfig) {
    throw {
      code: RPCErrorCode.INVALID_PARAMS,
      message: "spawnChild requires parentId and childConfig",
    };
  }

  const { parentId, childConfig } = params;

  // Permission lattice: check parent exists in registry
  const parentEntry = agentRegistry.get(parentId);

  // Drain evasion prevention (Rule #35): DRAINING parent MUST NOT spawn children
  if (parentEntry && parentEntry.status === 'draining') {
    throw {
      code: Plan37RPCErrorCode.PARENT_DRAINING,
      message: `Parent agent "${parentId}" is DRAINING. Cannot spawn child agents.`,
      data: {
        code: 'SPAWN_DENIED',
        reason: 'DRAINING',
        parentId,
      },
    };
  }

  // SEC-003 (Plan38 C2): Path traversal prevention for configPath.
  // Resolve symlinks and verify child config is within parent's allowed scope.
  // MECHANISM: fail-closed (Rule #29).
  if (childConfig.configPath) {
    try {
      const realConfigPath = realpathSync(childConfig.configPath);
      const parentConfigDir = parentEntry ? dirname(parentEntry.configPath) : (ctx?.configPath ? dirname(ctx.configPath) : '');
      if (parentConfigDir && !isPathSafe(parentConfigDir, realConfigPath)) {
        throw {
          code: Plan37RPCErrorCode.PERMISSION_LATTICE_VIOLATION,
          message: `SEC-003: configPath "${childConfig.configPath}" resolves outside parent scope`,
          data: { code: 'SPAWN_DENIED', reason: 'PATH_TRAVERSAL', parentId },
        };
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === Plan37RPCErrorCode.PERMISSION_LATTICE_VIOLATION) {
        throw err;
      }
      throw {
        code: RPCErrorCode.INVALID_PARAMS,
        message: `SEC-003: configPath "${childConfig.configPath}" cannot be resolved`,
        data: { code: 'SPAWN_DENIED', reason: 'PATH_TRAVERSAL', parentId },
      };
    }
  }

  // Capability validation: child inherits zero capabilities (fail-closed, Plan37 C11).
  // Retrieve parent's registered comm capabilities for lattice check.
  const parentCommCaps = messageRouter.getAgentCapabilities(parentId) ?? {
    canSendTo: [],
    canReceiveFrom: [],
    exposedTools: [],
  };
  const childCommCaps = { canSendTo: [], canReceiveFrom: [], exposedTools: [] };
  const capResult = messageRouter.validateChildCapabilities(parentCommCaps, childCommCaps);
  if (!capResult.allowed) {
    throw {
      code: Plan37RPCErrorCode.PERMISSION_LATTICE_VIOLATION,
      message: `Capability validation failed: ${capResult.reason}`,
      data: { code: 'SPAWN_DENIED', reason: 'CAPABILITY_VIOLATION', parentId },
    };
  }

  // Permission lattice (Plan38 C11): enforce depth + budget/ceiling + comm-capability
  // constraints via validateSpawnConstraints. GAP-2026-06-15: this validator existed
  // with full logic but had ZERO production callers — spawn DEPTH was never enforced
  // despite the spawn-validator header's "non-bypassable" claim. Now wired. Path-subset
  // is intentionally NOT routed here (SEC-003 realpath above already gates configPath;
  // passing declared allowedPaths would risk false denials). Budget/ceiling are skipped
  // when the registry does not track them (parentRemaining* undefined → guarded checks).
  if (parentEntry) {
    let childAgentConfigForValidation: IAgentConfig | undefined;
    try {
      childAgentConfigForValidation = await loadConfig(childConfig.configPath);
    } catch {
      // Unreadable config here is non-fatal for lattice validation; spawn surfaces load errors.
    }
    try {
      validateSpawnConstraints({
        parentEntry,
        childConfig: { agentId: childConfig.agentId, configPath: childConfig.configPath },
        childAgentConfig: childAgentConfigForValidation,
        parentDepth: computeAgentDepth(parentId, agentRegistry),
        messageRouter,
      });
    } catch (err: unknown) {
      if (err instanceof SpawnDeniedError) {
        throw {
          code: Plan37RPCErrorCode.PERMISSION_LATTICE_VIOLATION,
          message: err.message,
          data: { code: 'SPAWN_DENIED', reason: err.reason, parentId },
        };
      }
      throw err;
    }
  }

  // Spawn the child daemon process.
  // Pass cluster HMAC key via env (OPENSTARRY_HMAC_KEY) — not via CLI args (not visible in ps).
  // SECURITY: hmacKeyHex MUST NOT appear in args array (visible in ps output).
  const spawnOptions = {
    agentId: childConfig.agentId,
    configPath: childConfig.configPath,
    statePath: childConfig.statePath,
    env: {
      ...childConfig.env,
      ...(ctx.hmacKeyHex ? { OPENSTARRY_HMAC_KEY: ctx.hmacKeyHex } : {}),
    },
  };

  const result = await spawnDaemon(spawnOptions);

  // SEC-002 (Plan38 C1): Record PID-to-agentId mapping for identity verification.
  pidToAgentMap.set(result.pid, childConfig.agentId);

  // Cache child's configured gracePeriodMs for use at shutdown time.
  // Load the child's config to extract communication.gracePeriodMs.
  try {
    const childAgentConfig = await loadConfig(childConfig.configPath);
    const configuredGrace = childAgentConfig.communication?.gracePeriodMs;
    if (configuredGrace !== undefined) {
      agentGracePeriods.set(childConfig.agentId, configuredGrace);
    }
  } catch {
    // Config load failure at spawn time is non-fatal; gracefulStopAgent falls back to default.
  }

  // Register child in process tree
  const childEntry: AgentRegistryEntry = {
    agentId: childConfig.agentId,
    pid: result.pid,
    status: 'running',
    configPath: childConfig.configPath,
    socketPath: result.socketPath,
    logFile: result.logFile,
    uptime: 0,
    parentAgentId: parentId,
    childAgentIds: [],
  };
  agentRegistry.set(childConfig.agentId, childEntry);
  agentStatuses.set(childConfig.agentId, 'running');

  // Register child with zero comm capabilities in MessageRouter (Plan37 C11).
  messageRouter.registerAgent(childConfig.agentId, childCommCaps);

  // Update parent's childAgentIds
  if (parentEntry) {
    parentEntry.childAgentIds.push(childConfig.agentId);
  }

  console.error(`[daemon] Spawned child agent ${childConfig.agentId} (pid: ${result.pid}) under parent ${parentId}`);

  return result;
}

/**
 * Handle agent.processTree RPC — return the complete process tree.
 */
function handleProcessTree(): ProcessTreeNode[] {
  // Find root entries (no parentAgentId)
  const roots: AgentRegistryEntry[] = [];
  for (const entry of agentRegistry.values()) {
    if (!entry.parentAgentId) {
      roots.push(entry);
    }
  }

  function buildNode(entry: AgentRegistryEntry, depth: number): ProcessTreeNode {
    const children: ProcessTreeNode[] = [];
    if (depth < 3) {
      for (const childId of entry.childAgentIds) {
        const childEntry = agentRegistry.get(childId);
        if (childEntry) {
          children.push(buildNode(childEntry, depth + 1));
        }
      }
    }
    return { entry, children };
  }

  return roots.map(root => buildNode(root, 0));
}

/**
 * Graceful shutdown for a registered child agent (C14).
 *
 * Protocol:
 *   1. Set status to 'draining', publish agent:leaving via EventBridge.
 *   2. Wait for grace period (configuredGracePeriodMs ?? DEFAULT, clamped to MAX).
 *   3. After grace: set status 'terminated', deregister from EventBridge,
 *      GlobalServiceRegistry, and MessageRouter.
 *   4. Force-kill if still running after MAX_AGENT_GRACE_PERIOD_MS.
 *
 * @param agentId - The agent to stop.
 * @param configuredGracePeriodMs - Per-agent grace period from IAgentConfig.communication.gracePeriodMs.
 *   When provided this value is used (clamped to MAX_AGENT_GRACE_PERIOD_MS).
 *   When omitted, DEFAULT_AGENT_GRACE_PERIOD_MS is used.
 */
async function gracefulStopAgent(agentId: string, configuredGracePeriodMs?: number): Promise<void> {
  const entry = agentRegistry.get(agentId);
  if (!entry) return;

  // Step 1: transition to draining
  entry.status = 'draining';
  agentStatuses.set(agentId, 'draining');

  // Publish agent:leaving to EventBridge (fail-open per Rule #29)
  try {
    eventBridge.publish({
      type: 'agent:leaving',
      agentId,
      timestamp: Date.now(),
    });
  } catch {
    // fail-open
  }

  // Resolve grace period: explicit param > cached registry value > policy default.
  // Always clamp to mechanism ceiling (MAX_AGENT_GRACE_PERIOD_MS).
  const resolvedConfiguredGrace = configuredGracePeriodMs ?? agentGracePeriods.get(agentId);
  const gracePeriodMs = Math.min(
    resolvedConfiguredGrace ?? DEFAULT_AGENT_GRACE_PERIOD_MS,
    MAX_AGENT_GRACE_PERIOD_MS,
  );

  // Step 2: wait for grace period
  await new Promise<void>((resolve) => setTimeout(resolve, gracePeriodMs));

  // Step 3: transition to terminated, cleanup registrations
  entry.status = 'terminated';
  agentStatuses.set(agentId, 'terminated');
  eventBridge.deregisterAgent(agentId);
  globalServiceRegistry.deregisterAgent(agentId);
  messageRouter.deregisterAgent(agentId);
  agentGracePeriods.delete(agentId);
  // SEC-002 (Plan38 C1): Remove PID-to-agentId mapping on termination (no memory leak).
  removePidIdentity(entry.pid, pidToAgentMap);

  console.error(`[daemon] Agent ${agentId} gracefully terminated`);
}

/**
 * Handle agent.childAgents RPC — return direct children of a parent agent.
 */
function handleChildAgents(params: { parentId: string }): AgentRegistryEntry[] {
  if (!params || !params.parentId) {
    throw {
      code: RPCErrorCode.INVALID_PARAMS,
      message: "childAgents requires parentId",
    };
  }

  const parentEntry = agentRegistry.get(params.parentId);
  if (!parentEntry) {
    return [];
  }

  const children: AgentRegistryEntry[] = [];
  for (const childId of parentEntry.childAgentIds) {
    const childEntry = agentRegistry.get(childId);
    if (childEntry) {
      children.push(childEntry);
    }
  }
  return children;
}

/**
 * Get current agent status.
 */
function getAgentStatus(): AgentStatus {
  if (!ctx) {
    throw new Error("Daemon context not initialized");
  }

  return {
    agentId: ctx.agentId,
    pid: process.pid,
    status: "running",
    uptime: Math.floor((Date.now() - ctx.startTime) / 1000),
    configPath: ctx.configPath,
    logFile: ctx.logFile,
    socketPath: ctx.socketPath,
  };
}

/**
 * Graceful shutdown handler.
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.error(`[daemon] Received ${signal}, shutting down...`);

  if (!ctx) {
    console.error("[daemon] Context not initialized, exiting immediately");
    process.exit(0);
  }

  try {
    // Stop cleanup interval
    if (ctx.cleanupInterval) {
      clearInterval(ctx.cleanupInterval);
      ctx.cleanupInterval = null;
      console.error("[daemon] Cleanup task stopped");
    }

    // Save all active sessions
    const sessions = ctx.core.sessionManager.list();
    console.error(`[daemon] Saving ${sessions.length} active session(s)...`);
    for (const session of sessions) {
      const stateManager = ctx.core.sessionManager.getStateManager(session.id);
      const messages = stateManager.getMessages();
      await ctx.persistence.save(ctx.agentId, session, messages);
    }
    console.error("[daemon] All sessions saved");

    // GAP-2026-06-11 (T3b): cascade shutdown to spawned child daemons —
    // the first-ever reap path. Children are DETACHED processes; before this
    // change, parent shutdown left them running as permanent orphans
    // (gracefulStopAgent had zero call sites and, despite its doc comment,
    // never signalled the child PID). Each child gets SIGTERM — its own
    // daemon runs its own graceful shutdown — plus immediate bookkeeping
    // deregistration. No per-child grace wait here: the parent is dying and
    // shutdownWithTimeout caps the whole cascade at 30s.
    // GAP-2026-06-15: drive the cascade through PermissionLattice.cascadeTermination
    // (recursive, grandchild-first) — this function had full logic but ZERO callers;
    // the flat loop reaped the tree in registry-iteration order. Same reaping outcome
    // (every non-root entry gets SIGTERM + bookkeeping), now via the typed lattice with
    // correct leaf-first ordering. A fallback sweep catches any entry not reachable from
    // a root (orphaned bookkeeping), preserving the prior loop's completeness.
    const terminateChildEntry = async (agentId: string): Promise<void> => {
      const entry = agentRegistry.get(agentId);
      if (!entry || entry.status === 'terminated' || !entry.parentAgentId) return;
      try {
        process.kill(entry.pid, 'SIGTERM');
        console.error(`[daemon] SIGTERM sent to child agent ${entry.agentId} (pid: ${entry.pid})`);
      } catch {
        // already gone
      }
      entry.status = 'terminated';
      agentStatuses.set(entry.agentId, 'terminated');
      eventBridge.deregisterAgent(entry.agentId);
      globalServiceRegistry.deregisterAgent(entry.agentId);
      messageRouter.deregisterAgent(entry.agentId);
      agentGracePeriods.delete(entry.agentId);
      removePidIdentity(entry.pid, pidToAgentMap);
    };
    const shutdownLattice = new PermissionLattice(agentRegistry, terminateChildEntry);
    for (const entry of [...agentRegistry.values()]) {
      if (!entry.parentAgentId) {
        await shutdownLattice.cascadeTermination(entry.agentId);
      }
    }
    // Fallback sweep: any non-root entry not reached via a root tree.
    for (const entry of [...agentRegistry.values()]) {
      if (entry.parentAgentId && entry.status !== 'terminated') {
        await terminateChildEntry(entry.agentId);
      }
    }

    // Unsubscribe event forwarder
    if (eventForwarderUnsub) {
      eventForwarderUnsub();
      eventForwarderUnsub = null;
      console.error("[daemon] Event forwarder stopped");
    }

    // Stop IPC server
    await ctx.ipcServer.stop();
    console.error("[daemon] IPC server stopped");

    // Stop agent core
    await ctx.core.stop();
    console.error("[daemon] Agent core stopped");

    // Cleanup PID file
    pidManager.deletePid(ctx.pidFile);
    console.error("[daemon] PID file removed");

    console.error("[daemon] Shutdown complete");
    process.exit(0);
  } catch (err) {
    console.error(`[daemon] Shutdown error: ${err}`);
    process.exit(1);
  }
}

/**
 * Shutdown with timeout (30 seconds max).
 */
async function shutdownWithTimeout(signal: string): Promise<void> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Shutdown timeout")), 30000)
  );

  try {
    await Promise.race([shutdown(signal), timeoutPromise]);
  } catch {
    console.error("[daemon] Forced exit after timeout");
    process.exit(1);
  }
}

/**
 * Compile-time verification that the RPC handler functions collectively satisfy
 * IDaemonControlPlane. TypeScript will raise a type error if any method is missing
 * or has the wrong signature.
 *
 * FINDING-1 fix: enforces interface completeness at the type level.
 */
const _controlPlane: IDaemonControlPlane = {
  ping: async () => ({ pong: true }),
  getAgentStatus: async () => getAgentStatus(),
  stopAgent: async () => { setImmediate(() => shutdown("RPC")); return { success: true }; },
  getDaemonHealth: async () => ({
    uptime: ctx ? Math.floor((Date.now() - ctx.startTime) / 1000) : 0,
    version: ctx?.config.identity.version ?? "unknown",
  }),
  attachSession: (options, socket) => handleAttach(options, socket),
  pushAgentInput: async (msg) => { await handleInput(msg); return { success: true as const }; },
  detachSession: async (msg, socket) => { await handleDetach(msg, socket); return { success: true as const }; },
  listClients: async () => handleListClients(),
  spawnChildAgent: (parentId, childConfig) => handleSpawnChild({ parentId, childConfig }),
  getProcessTree: async () => handleProcessTree(),
  getChildAgents: async (parentId: string) => handleChildAgents({ parentId }),
};
// Prevent tree-shaking from removing the verification object.
void _controlPlane;

// Run if called directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[daemon] Fatal error: ${err}`);
    process.exit(1);
  });
}
