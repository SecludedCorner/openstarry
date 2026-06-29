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
import { dirname, join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import type { IAgentConfig, InputEvent, ISeed, IDaemonSpawnService, IDaemonIntrospectService, DaemonChildAgentInfo, DaemonProcessTreeNode, IDaemonCommService, CommMessage, CommPerformative, DaemonPeerEndpoint, SupervisorStrategy, DaemonForkResult } from "@openstarry/sdk";
import { DEFAULT_AGENT_GRACE_PERIOD_MS, MAX_AGENT_GRACE_PERIOD_MS, DEFAULT_SUPERVISOR_STRATEGY, SERVICE_KEYS, SpawnDeniedError } from "@openstarry/sdk";
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
import { EventBridge, type CoordinationMessage, type CoordinationMessageType } from "./event-bridge.js";
import { GlobalServiceRegistry } from "./global-service-registry.js";
import { verifyAgentIdentity, removePidIdentity } from "./pid-identity.js";
import { createObservability, type Observability } from "../observability.js";
import { isoTimestamp } from "../audit-infra/iso-timestamp.js";
import { GenerationCounter } from "./generation-counter.js";
import { CommTransport } from "./comm-transport.js";
import { verifyCommMessage, verifyCanonical } from "./comm-signature.js";
import { selectRestartSet, withinRestartBudget, type SupervisionEntry } from "./supervisor.js";

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
/**
 * ⑦ Observability (Tech Spec 18 / Doc 46) — daemon-side structured-log +
 * denial audit. Opt-in: createObservability() yields null log/auditBus unless
 * OPENSTARRY_LOG_PATH / OPENSTARRY_AUDIT (or AUDIT_SINK_PATH) are set, so the
 * lifecycle-log and denial-publish call sites are no-ops by default (zero
 * behavior change). Until this wire-in the daemon had NO observability at all —
 * rate-limit and spawn-constraint denials left no audit trail despite being
 * fail-closed security paths, and daemon lifecycle was console.error only.
 */
let obs: Observability | null = null;
let shuttingDown = false;
let eventForwarderUnsub: (() => void) | null = null;

/**
 * In-memory process tree registry.
 * Maps agentId -> AgentRegistryEntry.
 * Plan37 C8: stub implementation for process tree tracking.
 */
const agentRegistry = new Map<string, AgentRegistryEntry>();

/**
 * Per-parent, restart-persistent birth-order counter (Spec Addendum A, Fractal
 * Society Phase 1). Each parent counts its own children from 1; stored under
 * OPENSTARRY_HOME/generation (each daemon writes only its own parent file).
 */
const generationCounter = new GenerationCounter(
  join(OPENSTARRY_HOME, "generation"),
  (msg) => console.error(`[daemon] ${msg}`),
);

/**
 * MessageRouter — capability enforcement for inter-agent messaging.
 * Plan37 C11: fail-closed capability-based access control.
 */
const messageRouter = new MessageRouter();

/**
 * Fractal Society C/T1 (Spec Addendum C) — cross-daemon agent↔agent messaging.
 *
 * `commInbox` is this daemon's (single) agent's received-message log — the
 * durable source of truth for the `agent.inbox` tool / `comm.inbox` RPC,
 * bounded to the most recent COMM_INBOX_MAX entries.
 *
 * `commTransport` signs + delivers a CommMessage to a peer agent's daemon over
 * the proven line-delimited JSON-RPC wire (generalizes the alaya transport). It
 * is constructed in main() once the HMAC key + state path are known, so it is
 * null in foreground/CLI mode (the DAEMON_COMM service is daemon-only).
 */
const COMM_INBOX_MAX = 1000;
const commInbox: CommMessage[] = [];
let commTransport: CommTransport | null = null;

/**
 * C/T2 — cluster pub/sub coordination events this agent has received from peers
 * it subscribed to (the consumer side of EventBridge cross-daemon delivery),
 * bounded to the most recent COMM_INBOX_MAX. Until C/T2 the EventBridge had no
 * delivery layer at all (setDeliveryFn was never called → events were computed
 * then dropped); now publish() really reaches subscribers over the transport.
 */
const coordinationInbox: CoordinationMessage[] = [];

/**
 * C/T4 — request-response correlation. A `comm.request` registers a pending entry
 * keyed by the request message id; when a reply arrives (a CommMessage whose
 * `correlationId` == that id, the frozen-type convention) commDeliver resolves it.
 * Bounds itself: each entry has a timeout that rejects + removes it.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_REQUEST_TIMEOUT_MS = 300_000;
const pendingRequests = new Map<
  string,
  { resolve: (m: CommMessage) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; target: string }
>();

/**
 * Supervisor (Fractal Society) — restart crashed supervised children.
 * `childSpawnConfigs` retains each child's spawn config (recorded at spawn) so a
 * crashed child can be respawned identically — the HMAC key is re-injected from
 * ctx at restart, never persisted here. `supervisedChildren` holds the active
 * supervision policy per child; the monitor polls child pid liveness.
 */
const childSpawnConfigs = new Map<
  string,
  { configPath: string; statePath: string; env?: Record<string, string>; name?: string }
>();
const supervisedChildren = new Map<string, SupervisionEntry>();
let superviseSeq = 0;
let supervisorInterval: NodeJS.Timeout | null = null;
const SUPERVISOR_POLL_MS = 1_000;
const DEFAULT_MAX_RESTARTS = 3;

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
  // Fractal Society C/T1: the shared state dir this daemon's siblings live under.
  // Forwarded by the launcher (--state-path); used to resolve a peer agentId →
  // its daemon socket. Falls back to OPENSTARRY_HOME (the production default, and
  // backward-compatible with older callers that don't pass it).
  const statePath = (parsed.flags["state-path"] as string | undefined) ?? OPENSTARRY_HOME;

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

    // 3.5b Fractal Society C/T1 — construct the cross-daemon comm transport with
    // the cluster HMAC key (so outbound messages are signed) and the shared
    // state path (so a peer agentId resolves to its daemon socket via the same
    // getDefaultSocketPath the launcher used). Same-host, same-state-dir scope.
    commTransport = new CommTransport(statePath, hmacKeyHex);

    // 3.5c Fractal Society C/T2 — give EventBridge a real delivery layer. Until
    // now setDeliveryFn was never called, so publish() computed subscribers then
    // dropped the event. Now a published coordination event is delivered to each
    // remote subscriber's daemon (comm.event, HMAC-signed) over the transport.
    // Fire-and-forget: publish() is fail-open (Rule #29) — a delivery error to
    // one subscriber must not break the publish or the publisher.
    eventBridge.setDeliveryFn((subscriberId, event) => {
      void commTransport?.deliverEvent(subscriberId, event).catch((err) => {
        console.error(
          `[daemon] EventBridge delivery to ${subscriberId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    });

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
            ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            configPath: input.configPath,
            statePath: input.statePath ?? OPENSTARRY_HOME,
          },
        });
        return { pid: result.pid, agentId: result.agentId };
      },
      async supervise(childAgentId, strategy, maxRestarts) {
        return superviseChild(childAgentId, strategy, maxRestarts);
      },
      async fork(input) {
        return handleFork({
          parentId: agentId,
          parentSessionId: input.parentSessionId,
          childConfig: {
            ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            configPath: input.configPath,
            statePath: input.statePath ?? OPENSTARRY_HOME,
          },
        });
      },
      async branch(input) {
        return handleBranch({
          parentId: agentId,
          parentSessionId: input.parentSessionId,
          children: input.children.map((c) => ({
            ...(c.agentId !== undefined ? { agentId: c.agentId } : {}),
            ...(c.name !== undefined ? { name: c.name } : {}),
            configPath: c.configPath,
            statePath: c.statePath ?? OPENSTARRY_HOME,
          })),
        });
      },
    };
    core.serviceRegistry.register(spawnService);

    // 3.7 Register the read-only introspection service (Doc 11) so the
    // agent-introspect plugin's tools can enumerate this agent's children and
    // the process tree via SERVICE_KEYS.DAEMON_INTROSPECT. Read-only — no
    // spawn/kill here. Backed by the existing processTree/childAgents handlers.
    const introspectService: IDaemonIntrospectService = {
      name: "daemon-introspect",
      version: "1.0.0",
      async listChildren(parentAgentId: string): Promise<DaemonChildAgentInfo[]> {
        return handleChildAgents({ parentId: parentAgentId }).map(toChildAgentInfo);
      },
      async processTree(): Promise<DaemonProcessTreeNode[]> {
        return handleProcessTree().map((n) => toIntrospectTreeNode(n, 0));
      },
    };
    core.serviceRegistry.register(introspectService);

    // 3.8 Register the cross-daemon comm service (Fractal Society C/T1) so the
    // agent-comm plugin's agent.send / agent.inbox tools can message peer agents
    // and read this agent's inbox via SERVICE_KEYS.DAEMON_COMM. Backed by the
    // same commSend/commReadInbox the comm.* control-plane RPCs use — send()
    // enforces validateOutbound + signs + delivers; receipt is fail-closed
    // (HMAC + validateInbound) in commDeliver. Daemon-only; absent in CLI mode.
    const commService: IDaemonCommService = {
      name: "daemon-comm",
      version: "1.0.0",
      async send(input) {
        return commSend(input.target, input.payload, input.performative);
      },
      async readInbox(limit) {
        return commReadInbox(limit);
      },
      async subscribe(peerId, eventTypes) {
        return commSubscribeOutbound(peerId, eventTypes);
      },
      async readEvents(limit) {
        return commReadEvents(limit);
      },
      async registerService(registry, serviceName) {
        return commRegisterOutbound(registry, serviceName);
      },
      async findPeer(registry, serviceName) {
        return commFindPeer(registry, serviceName);
      },
      async request(target, payload, timeoutMs) {
        return commRequest(target, payload, timeoutMs);
      },
      async reply(target, correlationId, payload) {
        return commReply(target, correlationId, payload);
      },
      async broadcast(targets, payload, performative) {
        return commBroadcast(targets, payload, performative);
      },
      async pipeline(route, payload, performative) {
        return commPipelineInitiate(route, payload, performative);
      },
    };
    core.serviceRegistry.register(commService);

    // 4. Load plugins
    const pluginResult = await resolvePlugins(config, false, null);
    for (const plugin of pluginResult.plugins) {
      await core.loadPlugin(plugin);
    }
    console.error(`[daemon] ${pluginResult.plugins.length} plugin(s) loaded`);

    // 4.5 Doc 53: connect registered ICommChannels. The plugin loader populated
    // core.commChannelRegistry from each plugin's hooks.commChannels; until now
    // that registry had NO production consumer. Connecting them here (and the
    // inbound dispatch in commDeliver) makes plugin-provided channels live over
    // the real DAEMON_COMM transport. Fail-open: a channel that won't connect is
    // logged, not fatal.
    for (const ch of core.commChannelRegistry.list()) {
      try {
        await ch.connect();
      } catch (err) {
        console.error(`[daemon] commChannel "${ch.name}" connect failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

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

    // 6.5 ⑦ Observability — opt-in daemon structured-log + denial audit.
    // No-op when env unset; flushed in shutdown() via obs.flush().
    obs = createObservability();

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
    obs?.log?.info("agent:registered", { agentId, pid: process.pid, role: "root" });

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
    obs?.log?.info("daemon:started", {
      agentId,
      pid: process.pid,
      version: config.identity.version,
      socketPath,
    });

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

    case "agent.list-sessions":
      // Doc 26 (v0.59.7-alpha): enumerate persisted sessions for this agent.
      // Read-only; producer FileSessionPersistence.listSessions rebuilds the
      // index from disk when the in-memory index file is missing.
      return ctx.persistence.listSessions(ctx.agentId);

    case "agent.spawnChild":
      return handleSpawnChild(req.params as { parentId: string; childConfig: ChildAgentSpawnConfig });

    case "agent.supervise": {
      const p = req.params as { agentId: string; strategy?: SupervisorStrategy; maxRestarts?: number } | undefined;
      if (!p || typeof p.agentId !== "string" || p.agentId.length === 0) {
        throw new Error("agent.supervise: agentId is required");
      }
      return superviseChild(p.agentId, p.strategy, p.maxRestarts);
    }

    case "agent.fork": {
      const p = req.params as { parentId: string; parentSessionId: string; childConfig: ChildAgentSpawnConfig } | undefined;
      if (!p || typeof p.parentId !== "string" || typeof p.parentSessionId !== "string" || !p.childConfig) {
        throw new Error("agent.fork: parentId, parentSessionId, childConfig are required");
      }
      return handleFork(p);
    }

    case "agent.branch": {
      const p = req.params as { parentId: string; parentSessionId: string; children: ChildAgentSpawnConfig[] } | undefined;
      if (!p || typeof p.parentId !== "string" || typeof p.parentSessionId !== "string" || !Array.isArray(p.children)) {
        throw new Error("agent.branch: parentId, parentSessionId, children[] are required");
      }
      return { results: await handleBranch(p) };
    }

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

    // ─── Fractal Society C/T1 (Spec Addendum C): cross-daemon comm surface ───
    // comm.deliver is the RECEIVER side: a peer daemon's CommTransport delivers a
    // signed CommMessage here; commDeliver re-verifies the HMAC with THIS
    // process's cluster-key copy and runs validateInbound (fail-closed) before
    // the inbox is touched. comm.send / comm.inbox form the control plane so
    // operators and e2e tests can drive messaging without an LLM turn (mirrors
    // the alaya.* control plane); the same functions back the DAEMON_COMM service.

    case "comm.deliver": {
      const raw = JSON.stringify(req.params ?? {});
      if (raw.length > 1_000_000) {
        throw new Error("comm.deliver: payload exceeds 1MB");
      }
      const p = req.params as { message: CommMessage; signature: string } | undefined;
      if (!p || typeof p.signature !== "string") {
        throw new Error("comm.deliver: message and signature are required");
      }
      return commDeliver(p.message, p.signature);
    }

    case "comm.send": {
      const p = req.params as { target: string; payload: unknown; performative?: CommPerformative } | undefined;
      if (!p || typeof p.target !== "string" || p.target.length === 0) {
        throw new Error("comm.send: target is required");
      }
      return commSend(p.target, p.payload, p.performative);
    }

    case "comm.inbox": {
      const p = (req.params ?? {}) as { limit?: number };
      return { messages: commReadInbox(p.limit) };
    }

    // ─── Fractal Society C/T4: performative/topology (request-response + broadcast) ───
    case "comm.request": {
      const p = req.params as { target: string; payload: unknown; timeoutMs?: number } | undefined;
      if (!p || typeof p.target !== "string" || p.target.length === 0) {
        throw new Error("comm.request: target is required");
      }
      const reply = await commRequest(p.target, p.payload, p.timeoutMs);
      return { reply };
    }

    case "comm.reply": {
      const p = req.params as { target: string; correlationId: string; payload: unknown } | undefined;
      if (!p || typeof p.target !== "string" || p.target.length === 0 || typeof p.correlationId !== "string") {
        throw new Error("comm.reply: target and correlationId are required");
      }
      return commReply(p.target, p.correlationId, p.payload);
    }

    case "comm.broadcast": {
      const p = req.params as { targets: string[]; payload: unknown; performative?: CommPerformative } | undefined;
      if (!p || !Array.isArray(p.targets)) {
        throw new Error("comm.broadcast: targets[] is required");
      }
      return { results: await commBroadcast(p.targets, p.payload, p.performative) };
    }

    case "comm.pipeline": {
      const p = req.params as { route: string[]; payload: unknown; performative?: CommPerformative } | undefined;
      if (!p || !Array.isArray(p.route) || p.route.length === 0) {
        throw new Error("comm.pipeline: route[] is required");
      }
      return commPipelineInitiate(p.route, p.payload, p.performative);
    }

    // ─── Doc 53 ICommChannel surface (consumes commChannelRegistry) ───
    // Drives / inspects a registered ICommChannel so the channel abstraction is
    // exercised end-to-end (control plane for the agent-facing channel + e2e).

    case "comm.channelList": {
      if (!ctx) throw new Error("comm.channelList: daemon context not initialized");
      return {
        channels: ctx.core.commChannelRegistry.list().map((c) => ({
          name: c.name,
          capabilities: c.capabilities,
          topology: c.topology,
          status: c.getStatus(),
        })),
      };
    }

    case "comm.channelSend": {
      if (!ctx) throw new Error("comm.channelSend: daemon context not initialized");
      const p = req.params as { channel: string; target: string; payload: unknown; performative?: CommPerformative } | undefined;
      if (!p || typeof p.channel !== "string" || typeof p.target !== "string" || p.target.length === 0) {
        throw new Error("comm.channelSend: channel and target are required");
      }
      const ch = ctx.core.commChannelRegistry.get(p.channel);
      if (!ch || typeof ch.send !== "function") {
        throw new Error(`comm.channelSend: no sendable channel "${p.channel}"`);
      }
      const message: CommMessage = {
        id: randomUUID(),
        timestamp: Date.now(),
        source: ctx.agentId,
        target: p.target,
        payload: p.payload,
        performative: p.performative ?? "inform",
        traceDepth: 0,
      };
      await ch.send(p.target, message);
      return { sent: true, channel: p.channel };
    }

    case "comm.channelReceived": {
      if (!ctx) throw new Error("comm.channelReceived: daemon context not initialized");
      const p = (req.params ?? {}) as { channel: string };
      const ch = ctx.core.commChannelRegistry.get(p.channel) as
        | { getReceived?: () => CommMessage[] }
        | undefined;
      return { messages: typeof ch?.getReceived === "function" ? ch.getReceived() : [] };
    }

    // ─── Fractal Society C/T2: cross-daemon cluster pub/sub ───
    // comm.subscribe (receiver, publisher side) + comm.event (receiver,
    // subscriber side) are the HMAC-authenticated wire; comm.subscribeTo /
    // eventbridge.publish / comm.events form the control plane for the agent-comm
    // tools and e2e drivers.

    case "comm.subscribe": {
      const p = req.params as { subscription: { subscriber?: unknown; eventTypes?: unknown }; signature: string } | undefined;
      if (!p || typeof p.signature !== "string" || typeof p.subscription !== "object" || p.subscription === null) {
        throw new Error("comm.subscribe: subscription and signature are required");
      }
      return commSubscribeInbound(p.subscription, p.signature);
    }

    case "comm.subscribeTo": {
      const p = req.params as { target: string; eventTypes: string[] } | undefined;
      if (!p || typeof p.target !== "string" || p.target.length === 0) {
        throw new Error("comm.subscribeTo: target is required");
      }
      return commSubscribeOutbound(p.target, p.eventTypes);
    }

    case "comm.event": {
      const raw = JSON.stringify(req.params ?? {});
      if (raw.length > 1_000_000) {
        throw new Error("comm.event: payload exceeds 1MB");
      }
      const p = req.params as { event: CoordinationMessage; signature: string } | undefined;
      if (!p || typeof p.signature !== "string" || typeof p.event !== "object" || p.event === null) {
        throw new Error("comm.event: event and signature are required");
      }
      return commDeliverEvent(p.event, p.signature);
    }

    case "eventbridge.publish": {
      const p = req.params as { type: string; payload?: unknown } | undefined;
      if (!p || typeof p.type !== "string" || p.type.length === 0) {
        throw new Error("eventbridge.publish: type is required");
      }
      return commPublish(p.type, p.payload);
    }

    case "comm.events": {
      const p = (req.params ?? {}) as { limit?: number };
      return { events: commReadEvents(p.limit) };
    }

    // ─── Fractal Society C/T3: service discovery ───
    // comm.register / comm.lookup are the HMAC-authenticated hub-side wire;
    // comm.registerOn / comm.findPeer form the control plane for the agent-comm
    // discovery tools and e2e drivers.

    case "comm.register": {
      const p = req.params as { registration: { serviceName?: unknown; agentId?: unknown; socketPath?: unknown }; signature: string } | undefined;
      if (!p || typeof p.signature !== "string" || typeof p.registration !== "object" || p.registration === null) {
        throw new Error("comm.register: registration and signature are required");
      }
      return commRegisterInbound(p.registration, p.signature);
    }

    case "comm.lookup": {
      const p = req.params as { request: { serviceName?: unknown; requester?: unknown }; signature: string } | undefined;
      if (!p || typeof p.signature !== "string" || typeof p.request !== "object" || p.request === null) {
        throw new Error("comm.lookup: request and signature are required");
      }
      return commLookupInbound(p.request, p.signature);
    }

    case "comm.registerOn": {
      const p = req.params as { registry: string; serviceName: string } | undefined;
      if (!p || typeof p.registry !== "string" || p.registry.length === 0) {
        throw new Error("comm.registerOn: registry is required");
      }
      return commRegisterOutbound(p.registry, p.serviceName);
    }

    case "comm.findPeer": {
      const p = req.params as { registry: string; serviceName: string } | undefined;
      if (!p || typeof p.registry !== "string" || p.registry.length === 0) {
        throw new Error("comm.findPeer: registry is required");
      }
      return { providers: await commFindPeer(p.registry, p.serviceName) };
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

// ─── Fractal Society C/T1 — cross-daemon comm (Spec Addendum C) ───
// Throwing here uses Error (not the {code,message} object literal the alaya
// cases use) on purpose: the IPC server's error path only preserves err.message
// for Error instances, and the DAEMON_COMM service calls these IN-PROCESS — so
// an Error surfaces a clean denial reason to the model on BOTH paths.

/** ⑦ Journal a fail-closed comm rejection (the new cross-process attack surface). */
function auditCommDenied(detail: string): void {
  obs?.publishAgentRequestDenied({
    reason: 'comm_denied',
    agentId: ctx?.agentId ?? 'unknown',
    detail,
    timestamp: isoTimestamp(),
  });
}

/**
 * Send a message to a peer agent's daemon (sender side). Enforces the local
 * source agent's canSendTo (validateOutbound) — the receiver independently
 * enforces canReceiveFrom + replay + HMAC. The daemon fills id/timestamp/
 * source/traceDepth; the caller supplies target/payload/performative.
 */
async function commSend(
  target: string,
  payload: unknown,
  performative?: CommPerformative,
  correlationId?: string,
): Promise<{ delivered: boolean; messageId: string }> {
  if (!ctx) throw new Error("comm.send: daemon context not initialized");
  if (!commTransport) throw new Error("comm.send: transport unavailable (daemon mode only)");

  const check = messageRouter.validateOutbound(ctx.agentId, target);
  if (!check.allowed) {
    auditCommDenied(`OUTBOUND:${check.reason ?? ''}`);
    throw new Error(`comm.send denied: ${check.reason}`);
  }

  const message: CommMessage = {
    id: randomUUID(),
    timestamp: Date.now(),
    source: ctx.agentId,
    target,
    payload,
    performative: performative ?? 'inform',
    traceDepth: 0,
    ...(correlationId !== undefined ? { correlationId } : {}),
  };
  const res = await commTransport.deliver(target, message);
  return { delivered: res.delivered, messageId: message.id };
}

/**
 * C/T4 — send a `request` and await the correlated reply (or timeout). Registers
 * a pending entry keyed by the request id BEFORE the reply can arrive; commDeliver
 * resolves it when a message with matching correlationId is delivered back.
 */
async function commRequest(
  target: string,
  payload: unknown,
  timeoutMs?: number,
): Promise<CommMessage> {
  if (!ctx) throw new Error("comm.request: daemon context not initialized");
  if (!commTransport) throw new Error("comm.request: transport unavailable (daemon mode only)");

  const check = messageRouter.validateOutbound(ctx.agentId, target);
  if (!check.allowed) {
    auditCommDenied(`OUTBOUND:${check.reason ?? ''}`);
    throw new Error(`comm.request denied: ${check.reason}`);
  }

  const id = randomUUID();
  const message: CommMessage = {
    id,
    timestamp: Date.now(),
    source: ctx.agentId,
    target,
    payload,
    performative: 'request',
    traceDepth: 0,
  };
  const ms = Math.min(
    typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS,
    MAX_REQUEST_TIMEOUT_MS,
  );

  const reply = new Promise<CommMessage>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`comm.request to "${target}" timed out after ${ms}ms (no correlated reply)`));
    }, ms);
    pendingRequests.set(id, { resolve, reject, timer, target });
  });

  try {
    await commTransport.deliver(target, message);
  } catch (err) {
    const pending = pendingRequests.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRequests.delete(id);
    }
    throw err;
  }
  return reply;
}

/** C/T4 — reply to a request: a message carrying correlationId = the request id. */
async function commReply(
  target: string,
  correlationId: string,
  payload: unknown,
): Promise<{ delivered: boolean; messageId: string }> {
  if (typeof correlationId !== 'string' || correlationId.length === 0) {
    throw new Error("comm.reply: correlationId is required");
  }
  return commSend(target, payload, 'inform', correlationId);
}

/**
 * C/T4 — broadcast: fan-out to multiple targets; each send independently
 * capability-checked (validateOutbound). One target failing does not abort the
 * rest — the per-target result carries delivered/error.
 */
async function commBroadcast(
  targets: string[],
  payload: unknown,
  performative?: CommPerformative,
): Promise<Array<{ target: string; delivered: boolean; error?: string }>> {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("comm.broadcast: targets[] is required");
  }
  const results: Array<{ target: string; delivered: boolean; error?: string }> = [];
  for (const target of targets) {
    try {
      const res = await commSend(target, payload, performative);
      results.push({ target, delivered: res.delivered });
    } catch (err) {
      results.push({ target, delivered: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

// ─── Fractal Society pipeline topology (CommTopology 'pipeline') ───
// A source-routed relay: the initiator fixes an ordered hop list [B,C,...]; each
// daemon, on receiving a pipeline message with hops remaining, relays it to the
// next hop (capability-checked + HMAC-signed per hop; traceDepth bounds length to
// MAX_TRACE_DEPTH). The cross-daemon form of the frozen PipelineChannel (whose
// in-process callback form is degenerate under 1-daemon-1-agent). Per-stage payload
// transformation is the agent loop's job (not the transport's).

/** A message is a pipeline message iff it carries a pipelineRoute in metadata. */
function isPipelineMessage(m: CommMessage): boolean {
  return typeof m.metadata?.pipelineRoute === "string";
}

/** Low-level: validate canSendTo + build a message carrying metadata + deliver. */
async function commPipelineForward(
  target: string,
  payload: unknown,
  performative: CommPerformative,
  metadata: Record<string, string>,
  traceDepth: number,
): Promise<void> {
  if (!ctx) throw new Error("comm.pipeline: daemon context not initialized");
  if (!commTransport) throw new Error("comm.pipeline: transport unavailable (daemon mode only)");
  const check = messageRouter.validateOutbound(ctx.agentId, target);
  if (!check.allowed) {
    auditCommDenied(`PIPELINE_OUTBOUND:${check.reason ?? ''}`);
    throw new Error(`comm.pipeline denied: ${check.reason}`);
  }
  const message: CommMessage = {
    id: randomUUID(),
    timestamp: Date.now(),
    source: ctx.agentId,
    target,
    payload,
    performative,
    traceDepth,
    metadata,
  };
  await commTransport.deliver(target, message);
}

/** Initiate a pipeline: send to the first hop with the remaining route in metadata. */
async function commPipelineInitiate(
  route: string[],
  payload: unknown,
  performative?: CommPerformative,
): Promise<{ delivered: boolean; pipelineId: string; firstHop: string }> {
  if (!ctx) throw new Error("comm.pipeline: daemon context not initialized");
  if (!Array.isArray(route) || route.length === 0) {
    throw new Error("comm.pipeline: route[] is required");
  }
  const firstHop = route[0];
  const rest = route.slice(1);
  const pipelineId = randomUUID();
  await commPipelineForward(
    firstHop,
    payload,
    performative ?? "request",
    {
      pipelineRoute: JSON.stringify(rest),
      pipelineId,
      pipelineTrail: JSON.stringify([ctx.agentId]),
    },
    1,
  );
  return { delivered: true, pipelineId, firstHop };
}

/** Read this agent's inbox (most-recent `limit` messages; all if omitted). */
function commReadInbox(limit?: number): CommMessage[] {
  if (typeof limit === 'number' && Number.isInteger(limit) && limit >= 0) {
    return commInbox.slice(Math.max(0, commInbox.length - limit));
  }
  return commInbox.slice();
}

/**
 * Receive a signed CommMessage from a peer daemon (receiver side). Fail-closed:
 * HMAC verify (source is the capability basis → must be unforgeable) → shape →
 * validateInbound (canReceiveFrom + replay + freshness + envelope) → durable
 * inbox (bounded) → best-effort wake the local cognition loop. The remote sender
 * is NOT locally registered; its identity comes from the HMAC.
 */
async function commDeliver(
  message: CommMessage,
  signature: string,
): Promise<{ delivered: boolean }> {
  if (!ctx) throw new Error("comm.deliver: daemon context not initialized");

  // 1. Authenticity (fail-closed). verifyCommMessage never throws on malformed
  // input — it returns false — so a bad/forged signature is a clean denial.
  if (!verifyCommMessage(message, signature, ctx.hmacKeyHex)) {
    const src = message && typeof message === 'object' ? String((message as CommMessage).source ?? '?') : '?';
    auditCommDenied(`HMAC:${src}`);
    throw new Error("comm.deliver: HMAC verification failed (fail-closed)");
  }

  // 2. Capability + replay + freshness + envelope (fail-closed).
  const check = messageRouter.validateInbound(message);
  if (!check.allowed) {
    auditCommDenied(`INBOUND:${check.reason ?? ''}`);
    throw new Error(`comm.deliver denied: ${check.reason}`);
  }

  // 3. Durable inbox (source of truth for agent.inbox), bounded to the tail.
  commInbox.push(message);
  if (commInbox.length > COMM_INBOX_MAX) {
    commInbox.splice(0, commInbox.length - COMM_INBOX_MAX);
  }

  // 3b. C/T4 request-response: if this is a reply correlated to a pending
  // request (correlationId == an awaited request id), resolve that request and
  // consume the message here — the awaiting commRequest() caller handles it, so
  // do NOT also wake the loop via pushInput (avoid double-processing).
  // SECURITY: the reply MUST come from the agent the request was sent to
  // (pending.target). A correlationId match from a DIFFERENT (even HMAC-valid,
  // capability-allowed) sender must NOT hijack the pending request — bind the
  // correlation to the expected peer. A mismatch is journaled and falls through
  // to normal delivery (the genuine reply may still arrive / the request times out).
  const corr = message.correlationId;
  if (typeof corr === 'string' && pendingRequests.has(corr)) {
    const pending = pendingRequests.get(corr)!;
    if (message.source === pending.target) {
      clearTimeout(pending.timer);
      pendingRequests.delete(corr);
      pending.resolve(message);
      return { delivered: true };
    }
    auditCommDenied(`CORRELATION_SOURCE:${message.source}!=${pending.target}`);
  }

  // 3c. Pipeline topology relay: if this is a pipeline message with hops left,
  // forward to the next hop (fire-and-forget — do NOT block the ack to the
  // previous hop on the downstream delivery). Each hop is capability-checked +
  // HMAC-signed inside commPipelineForward; a denied hop stops the chain there
  // and is journaled. The message still lands in THIS hop's inbox above.
  if (isPipelineMessage(message)) {
    let remaining: string[] = [];
    try { remaining = JSON.parse(message.metadata!.pipelineRoute) as string[]; } catch { remaining = []; }
    if (Array.isArray(remaining) && remaining.length > 0) {
      const nextHop = remaining[0];
      const rest = remaining.slice(1);
      let trail: string[] = [];
      try { trail = JSON.parse(message.metadata!.pipelineTrail ?? "[]") as string[]; } catch { trail = []; }
      trail.push(ctx.agentId);
      void commPipelineForward(
        nextHop,
        message.payload,
        message.performative ?? "request",
        {
          pipelineRoute: JSON.stringify(rest),
          pipelineId: message.metadata!.pipelineId ?? "",
          pipelineTrail: JSON.stringify(trail),
        },
        (message.traceDepth ?? 0) + 1,
      ).catch((err) => {
        console.error(`[daemon] pipeline forward to ${nextHop} failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  // 4. Best-effort wake the local agent's cognition loop with a readable
  // notification. The structured message is already durable in the inbox, so a
  // pushInput failure must NOT fail the delivery.
  try {
    const body = typeof message.payload === 'string' ? message.payload : JSON.stringify(message.payload);
    ctx.core.pushInput({
      source: 'comm',
      inputType: 'agent_message',
      data: `[agent-message from ${message.source}] ${body}`,
    });
  } catch (err) {
    console.error(`[daemon] comm.deliver: pushInput failed (message retained in inbox): ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. Doc 53: dispatch to registered ICommChannel handlers — CONSUMES the
  // commChannelRegistry (previously populated but never read) so plugin-provided
  // channels' onMessage handlers fire on real inbound traffic. The frozen
  // ICommChannel has no inbound-injection method, so channel impls expose a
  // duck-typed deliverInbound for the daemon to feed. Fail-open per channel.
  dispatchToCommChannels(message);

  return { delivered: true };
}

/** Feed a received message to every registered messaging ICommChannel (Doc 53). */
function dispatchToCommChannels(message: CommMessage): void {
  if (!ctx) return;
  try {
    for (const ch of ctx.core.commChannelRegistry.list()) {
      const deliver = (ch as { deliverInbound?: (m: CommMessage, from: string) => void }).deliverInbound;
      if (typeof deliver === "function" && ch.capabilities.includes("messaging")) {
        try { deliver.call(ch, message, message.source); } catch { /* isolate per channel */ }
      }
    }
  } catch (err) {
    console.error(`[daemon] commChannel inbound dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Fractal Society C/T2 — cross-daemon cluster pub/sub (EventBridge) ───
// Subscriber-initiated: a subscriber's daemon calls comm.subscribe on the
// PUBLISHER's daemon (signed) to register itself; when the publisher publishes a
// lifecycle event, EventBridge.deliverFn delivers it back to each subscriber via
// comm.event (signed). Both directions are HMAC-authenticated (cluster key).

/** Outbound: register THIS agent for `eventTypes` on `target`'s EventBridge. */
async function commSubscribeOutbound(
  target: string,
  eventTypes: string[],
): Promise<{ subscribed: boolean }> {
  if (!ctx) throw new Error("comm.subscribeTo: daemon context not initialized");
  if (!commTransport) throw new Error("comm.subscribeTo: transport unavailable (daemon mode only)");
  if (!Array.isArray(eventTypes) || eventTypes.length === 0) {
    throw new Error("comm.subscribeTo: eventTypes[] is required");
  }
  return commTransport.subscribe(target, ctx.agentId, eventTypes);
}

/** Inbound: a peer registers itself as a subscriber on THIS daemon's EventBridge. */
function commSubscribeInbound(
  subscription: { subscriber?: unknown; eventTypes?: unknown },
  signature: string,
): { subscribed: boolean } {
  if (!ctx) throw new Error("comm.subscribe: daemon context not initialized");
  if (!verifyCanonical(subscription, signature, ctx.hmacKeyHex)) {
    const who = subscription && typeof subscription === "object" ? String(subscription.subscriber ?? "?") : "?";
    auditCommDenied(`SUBSCRIBE_HMAC:${who}`);
    throw new Error("comm.subscribe: HMAC verification failed (fail-closed)");
  }
  const subscriber = subscription.subscriber;
  const eventTypes = subscription.eventTypes;
  if (typeof subscriber !== "string" || subscriber.length === 0 || !Array.isArray(eventTypes)) {
    auditCommDenied("SUBSCRIBE_MALFORMED");
    throw new Error("comm.subscribe: malformed subscription (fail-closed)");
  }
  eventBridge.registerAgent(subscriber, eventTypes as string[]);
  return { subscribed: true };
}

/** Receiver: record a coordination event delivered from a peer's EventBridge. */
function commDeliverEvent(event: CoordinationMessage, signature: string): { received: boolean } {
  if (!ctx) throw new Error("comm.event: daemon context not initialized");
  if (!verifyCanonical(event, signature, ctx.hmacKeyHex)) {
    const who = event && typeof event === "object" ? String((event as CoordinationMessage).agentId ?? "?") : "?";
    auditCommDenied(`EVENT_HMAC:${who}`);
    throw new Error("comm.event: HMAC verification failed (fail-closed)");
  }
  coordinationInbox.push(event);
  if (coordinationInbox.length > COMM_INBOX_MAX) {
    coordinationInbox.splice(0, coordinationInbox.length - COMM_INBOX_MAX);
  }
  try {
    ctx.core.pushInput({
      source: "comm",
      inputType: "coordination_event",
      data: `[coordination ${event.type}] from ${event.agentId}`,
    });
  } catch (err) {
    console.error(`[daemon] comm.event: pushInput failed (event retained in inbox): ${err instanceof Error ? err.message : String(err)}`);
  }
  return { received: true };
}

/** Control plane: publish a coordination event from THIS agent to its subscribers. */
function commPublish(type: string, payload?: unknown): { published: boolean } {
  if (!ctx) throw new Error("eventbridge.publish: daemon context not initialized");
  eventBridge.publish({
    type: type as CoordinationMessageType,
    agentId: ctx.agentId,
    timestamp: Date.now(),
    ...(payload !== undefined ? { payload } : {}),
  });
  return { published: true };
}

/** Read this agent's received coordination events (most-recent `limit`). */
function commReadEvents(limit?: number): CoordinationMessage[] {
  if (typeof limit === "number" && Number.isInteger(limit) && limit >= 0) {
    return coordinationInbox.slice(Math.max(0, coordinationInbox.length - limit));
  }
  return coordinationInbox.slice();
}

// ─── Fractal Society C/T3 — service discovery closure (GlobalServiceRegistry) ───
// A daemon registers a named service on a registry HUB (comm.register, signed);
// a peer resolves a service name to its provider(s) via the same hub
// (comm.lookup, signed) and then messages a provider with comm.send. This closes
// the previously-dangling loop: the registry had register/lookup but nothing used
// a lookup result to actually talk to the discovered peer.

/** Inbound: a peer registers a service provider in THIS daemon's registry (hub). */
function commRegisterInbound(
  registration: { serviceName?: unknown; agentId?: unknown; socketPath?: unknown },
  signature: string,
): { registered: boolean } {
  if (!ctx) throw new Error("comm.register: daemon context not initialized");
  if (!verifyCanonical(registration, signature, ctx.hmacKeyHex)) {
    const who = registration && typeof registration === "object" ? String(registration.agentId ?? "?") : "?";
    auditCommDenied(`REGISTER_HMAC:${who}`);
    throw new Error("comm.register: HMAC verification failed (fail-closed)");
  }
  const { serviceName, agentId, socketPath } = registration;
  if (typeof serviceName !== "string" || serviceName.length === 0 || typeof agentId !== "string" || agentId.length === 0) {
    auditCommDenied("REGISTER_MALFORMED");
    throw new Error("comm.register: malformed registration (fail-closed)");
  }
  globalServiceRegistry.register(
    serviceName,
    agentId,
    typeof socketPath === "string" ? { socketPath } : undefined,
  );
  return { registered: true };
}

/** Inbound: a peer resolves a service name against THIS daemon's registry (hub). */
function commLookupInbound(
  request: { serviceName?: unknown; requester?: unknown },
  signature: string,
): { providers: DaemonPeerEndpoint[] } {
  if (!ctx) throw new Error("comm.lookup: daemon context not initialized");
  if (!verifyCanonical(request, signature, ctx.hmacKeyHex)) {
    const who = request && typeof request === "object" ? String(request.requester ?? "?") : "?";
    auditCommDenied(`LOOKUP_HMAC:${who}`);
    throw new Error("comm.lookup: HMAC verification failed (fail-closed)");
  }
  const { serviceName } = request;
  if (typeof serviceName !== "string" || serviceName.length === 0) {
    throw new Error("comm.lookup: serviceName is required");
  }
  const providers: DaemonPeerEndpoint[] = globalServiceRegistry.lookup(serviceName).map((r) => ({
    serviceName: r.serviceName,
    agentId: r.agentId,
    ...(typeof r.metadata?.socketPath === "string" ? { socketPath: r.metadata.socketPath } : {}),
  }));
  return { providers };
}

/** Outbound: register THIS agent as a provider of `serviceName` on `registry`. */
async function commRegisterOutbound(registry: string, serviceName: string): Promise<{ registered: boolean }> {
  if (!ctx) throw new Error("comm.registerOn: daemon context not initialized");
  if (!commTransport) throw new Error("comm.registerOn: transport unavailable (daemon mode only)");
  if (typeof serviceName !== "string" || serviceName.length === 0) {
    throw new Error("comm.registerOn: serviceName is required");
  }
  return commTransport.registerService(registry, serviceName, ctx.agentId, ctx.socketPath);
}

/** Outbound: discover providers of `serviceName` via the `registry` hub. */
async function commFindPeer(registry: string, serviceName: string): Promise<DaemonPeerEndpoint[]> {
  if (!ctx) throw new Error("comm.findPeer: daemon context not initialized");
  if (!commTransport) throw new Error("comm.findPeer: transport unavailable (daemon mode only)");
  if (typeof serviceName !== "string" || serviceName.length === 0) {
    throw new Error("comm.findPeer: serviceName is required");
  }
  return commTransport.lookupService(registry, serviceName, ctx.agentId);
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
      // ⑦ denial audit: a rate-limited input is a fail-closed rejection — journal it.
      obs?.publishAgentRequestDenied({
        reason: 'rate_limited',
        agentId: ctx.agentId,
        detail: `${err.limitType}:${msg.sessionId}`,
        timestamp: isoTimestamp(),
      });
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

  // ⑦ denial audit: every fail-closed spawn rejection is journaled with its
  // specific sub-reason. Covers all denial paths below (DRAINING / path /
  // capability / depth-budget-ceiling), not just one — a denial-audit that
  // logged a single reason would be misleading.
  const auditSpawnDenied = (detail: string): void => {
    obs?.publishAgentRequestDenied({
      reason: 'spawn_constraint',
      agentId: parentId,
      detail,
      timestamp: isoTimestamp(),
    });
  };

  // Spec Addendum A (Fractal Society Phase 1): assign a per-parent birth-order,
  // resolve the child's id (auto-generate `<parentId>-<generation>` when the
  // caller omits it), and reject an id COLLISION fail-closed — previously a
  // duplicate id silently overwrote the registry entry (agentRegistry.set), a
  // latent bug. `name` is an optional human label (defaults to the id).
  const generation = generationCounter.next(parentId);
  const childAgentId = childConfig.agentId ?? `${parentId}-${generation}`;
  if (agentRegistry.has(childAgentId)) {
    auditSpawnDenied(`ID_COLLISION:${childAgentId}`);
    throw {
      code: RPCErrorCode.INVALID_PARAMS,
      message: `Agent id "${childAgentId}" is already registered — spawn rejected (no silent overwrite).`,
      data: { code: 'SPAWN_DENIED', reason: 'ID_COLLISION', parentId },
    };
  }
  const childName = childConfig.name ?? childAgentId;

  // Permission lattice: check parent exists in registry
  const parentEntry = agentRegistry.get(parentId);

  // Drain evasion prevention (Rule #35): DRAINING parent MUST NOT spawn children
  if (parentEntry && parentEntry.status === 'draining') {
    auditSpawnDenied('DRAINING');
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
        auditSpawnDenied('PATH_TRAVERSAL');
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
      auditSpawnDenied('PATH_UNRESOLVABLE');
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
    auditSpawnDenied(`CAPABILITY_VIOLATION:${capResult.reason ?? ''}`);
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
        childConfig: { agentId: childAgentId, configPath: childConfig.configPath },
        childAgentConfig: childAgentConfigForValidation,
        parentDepth: computeAgentDepth(parentId, agentRegistry),
        messageRouter,
      });
    } catch (err: unknown) {
      if (err instanceof SpawnDeniedError) {
        auditSpawnDenied(err.reason);
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
    agentId: childAgentId,
    configPath: childConfig.configPath,
    statePath: childConfig.statePath,
    env: {
      ...childConfig.env,
      ...(ctx.hmacKeyHex ? { OPENSTARRY_HMAC_KEY: ctx.hmacKeyHex } : {}),
    },
  };

  const result = await spawnDaemon(spawnOptions);

  // SEC-002 (Plan38 C1): Record PID-to-agentId mapping for identity verification.
  pidToAgentMap.set(result.pid, childAgentId);

  // Cache child's configured gracePeriodMs for use at shutdown time.
  // Load the child's config to extract communication.gracePeriodMs.
  try {
    const childAgentConfig = await loadConfig(childConfig.configPath);
    const configuredGrace = childAgentConfig.communication?.gracePeriodMs;
    if (configuredGrace !== undefined) {
      agentGracePeriods.set(childAgentId, configuredGrace);
    }
  } catch {
    // Config load failure at spawn time is non-fatal; gracefulStopAgent falls back to default.
  }

  // Register child in process tree (Spec Addendum A: with name + generation).
  const childEntry: AgentRegistryEntry = {
    agentId: childAgentId,
    pid: result.pid,
    status: 'running',
    configPath: childConfig.configPath,
    socketPath: result.socketPath,
    logFile: result.logFile,
    uptime: 0,
    parentAgentId: parentId,
    childAgentIds: [],
    name: childName,
    generation,
  };
  agentRegistry.set(childAgentId, childEntry);
  agentStatuses.set(childAgentId, 'running');

  // Retain this child's spawn config so the supervisor can respawn it on crash
  // (HMAC key is NOT stored — re-injected from ctx at restart time).
  childSpawnConfigs.set(childAgentId, {
    configPath: childConfig.configPath,
    statePath: childConfig.statePath,
    ...(childConfig.env ? { env: childConfig.env } : {}),
    ...(childName ? { name: childName } : {}),
  });

  // Register child with zero comm capabilities in MessageRouter (Plan37 C11).
  messageRouter.registerAgent(childAgentId, childCommCaps);

  // Update parent's childAgentIds
  if (parentEntry) {
    parentEntry.childAgentIds.push(childAgentId);
  }

  console.error(`[daemon] Spawned child agent ${childName} [${childAgentId}] gen=${generation} (pid: ${result.pid}) under parent ${parentId}`);
  obs?.log?.info("agent:registered", {
    agentId: childAgentId,
    name: childName,
    generation,
    pid: result.pid,
    parentId,
    role: "child",
  });

  return result;
}

/** Map a daemon-internal registry entry to the SDK introspection summary. */
function toChildAgentInfo(e: AgentRegistryEntry): DaemonChildAgentInfo {
  return {
    agentId: e.agentId,
    pid: e.pid,
    status: e.status,
    configPath: e.configPath,
    uptime: e.uptime,
    childAgentIds: e.childAgentIds,
    ...(e.parentAgentId !== undefined ? { parentAgentId: e.parentAgentId } : {}),
    ...(e.name !== undefined ? { name: e.name } : {}),
    ...(e.generation !== undefined ? { generation: e.generation } : {}),
  };
}

/** Map a daemon-internal process-tree node to the SDK introspection node. */
function toIntrospectTreeNode(n: ProcessTreeNode, depth: number): DaemonProcessTreeNode {
  return {
    agentId: n.entry.agentId,
    pid: n.entry.pid,
    status: n.entry.status,
    depth,
    children: n.children.map((c) => toIntrospectTreeNode(c, depth + 1)),
    ...(n.entry.name !== undefined ? { name: n.entry.name } : {}),
    ...(n.entry.generation !== undefined ? { generation: n.entry.generation } : {}),
  };
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
// ─── Fractal Society — fork / branch (Spec Addendum B) ───
// fork = spawn a child + inject the parent's CURRENT session snapshot as the
// child's initial session. ONLY the session is inherited (D4-a); capabilities
// stay child ⊆ parent via the spawn lattice (D4-b, NOT bypassed — handleSpawnChild
// throws on violation); memory/alaya are NOT copied (D4-c). branch = N forks off
// the same snapshot (shared forkOrigin). merge/select = honest future.

type SessionSnapshot = Awaited<ReturnType<typeof loadSnapshotOrThrow>>;

async function loadSnapshotOrThrow(parentId: string, parentSessionId: string, op: string) {
  if (!ctx) throw new Error(`${op}: daemon context not initialized`);
  if (typeof parentSessionId !== "string" || parentSessionId.length === 0) {
    throw new Error(`${op}: parentSessionId is required`);
  }
  const snap = await ctx.persistence.load(parentId, parentSessionId);
  if (!snap) throw new Error(`${op}: parent session "${parentSessionId}" not found`);
  return snap;
}

/** Inject a parent snapshot as a child's initial session + record fork provenance. */
async function injectForkSnapshot(
  childAgentId: string,
  snap: SessionSnapshot,
  forkOrigin: string,
): Promise<void> {
  if (!ctx) throw new Error("fork: daemon context not initialized");
  const childEntry = agentRegistry.get(childAgentId);
  if (childEntry) childEntry.forkOrigin = forkOrigin;
  // ONLY the session messages cross over — no memory/alaya (Addendum B D4-c).
  await ctx.persistence.saveNow(
    childAgentId,
    { ...snap.session, updatedAt: Date.now(), metadata: { ...snap.session.metadata, forkOrigin } },
    snap.messages,
  );
}

async function handleFork(params: {
  parentId: string;
  parentSessionId: string;
  childConfig: ChildAgentSpawnConfig;
}): Promise<DaemonForkResult> {
  const { parentId, parentSessionId, childConfig } = params;
  const snap = await loadSnapshotOrThrow(parentId, parentSessionId, "agent.fork");
  // Spawn the child — capability lattice + SEC-003 enforced inside (throws on denial).
  const spawnResult = await handleSpawnChild({ parentId, childConfig });
  const forkOrigin = `${parentId}:${parentSessionId}`;
  await injectForkSnapshot(spawnResult.agentId, snap, forkOrigin);
  return {
    childAgentId: spawnResult.agentId,
    pid: spawnResult.pid,
    forkOrigin,
    sessionId: parentSessionId,
    messageCount: snap.messages.length,
  };
}

async function handleBranch(params: {
  parentId: string;
  parentSessionId: string;
  children: ChildAgentSpawnConfig[];
}): Promise<DaemonForkResult[]> {
  const { parentId, parentSessionId, children } = params;
  if (!Array.isArray(children) || children.length === 0) {
    throw new Error("agent.branch: children[] is required");
  }
  const snap = await loadSnapshotOrThrow(parentId, parentSessionId, "agent.branch");
  const forkOrigin = `${parentId}:${parentSessionId}`;
  const results: DaemonForkResult[] = [];
  for (const childConfig of children) {
    const spawnResult = await handleSpawnChild({ parentId, childConfig });
    await injectForkSnapshot(spawnResult.agentId, snap, forkOrigin);
    results.push({
      childAgentId: spawnResult.agentId,
      pid: spawnResult.pid,
      forkOrigin,
      sessionId: parentSessionId,
      messageCount: snap.messages.length,
    });
  }
  return results;
}

// ─── Fractal Society — supervisor restart strategy (one-for-one/all/rest-for-one) ───
// Enable restart-on-crash for a child THIS daemon spawned. A periodic monitor
// polls each supervised child's pid; a child whose process is dead while its
// registry status is still 'running' (crashed, not gracefully stopped) triggers a
// restart of the set chosen by selectRestartSet(). Honest scope: pid-liveness
// polling (not a robust OS supervision API); same-host; restart budget bounded.

/** Enable supervision for a child spawned by this daemon. */
function superviseChild(
  agentId: string,
  strategy?: SupervisorStrategy,
  maxRestarts?: number,
): { supervised: boolean; agentId: string; strategy: SupervisorStrategy } {
  if (!ctx) throw new Error("agent.supervise: daemon context not initialized");
  if (!childSpawnConfigs.has(agentId) || !agentRegistry.has(agentId)) {
    throw new Error(`agent.supervise: "${agentId}" is not a child of this agent`);
  }
  const strat = strategy ?? DEFAULT_SUPERVISOR_STRATEGY;
  const existing = supervisedChildren.get(agentId);
  supervisedChildren.set(agentId, {
    strategy: strat,
    maxRestarts: typeof maxRestarts === "number" && maxRestarts >= 0 ? maxRestarts : DEFAULT_MAX_RESTARTS,
    restartCount: existing?.restartCount ?? 0,
    order: existing?.order ?? superviseSeq++,
  });
  startSupervisorMonitor();
  return { supervised: true, agentId, strategy: strat };
}

/** Start the liveness monitor (idempotent). Unref'd so it never holds the loop open. */
function startSupervisorMonitor(): void {
  if (supervisorInterval) return;
  supervisorInterval = setInterval(() => { void superviseTick(); }, SUPERVISOR_POLL_MS);
  if (typeof supervisorInterval.unref === "function") supervisorInterval.unref();
}

/** One monitor tick: detect a crashed supervised child and restart its set. */
async function superviseTick(): Promise<void> {
  let deadId: string | undefined;
  for (const [agentId] of supervisedChildren) {
    const entry = agentRegistry.get(agentId);
    if (!entry) { supervisedChildren.delete(agentId); childSpawnConfigs.delete(agentId); continue; }
    // Crashed = process gone while registry still thinks it is running (a
    // graceful stop sets status 'terminated', so it is skipped here).
    if (entry.status === "running" && !pidManager.isProcessRunning(entry.pid)) {
      deadId = agentId;
      break;
    }
  }
  if (!deadId) return;
  const toRestart = selectRestartSet(deadId, supervisedChildren);
  for (const id of toRestart) {
    await restartSupervisedChild(id);
  }
}

/** Respawn a supervised child from its retained config (re-injecting the HMAC key). */
async function restartSupervisedChild(agentId: string): Promise<void> {
  const sup = supervisedChildren.get(agentId);
  const cfg = childSpawnConfigs.get(agentId);
  const entry = agentRegistry.get(agentId);
  if (!ctx || !sup || !cfg || !entry) return;

  if (!withinRestartBudget(sup)) {
    console.error(`[daemon] supervisor: "${agentId}" exceeded maxRestarts (${sup.maxRestarts}); giving up`);
    obs?.log?.info("agent:restart_giveup", { agentId, maxRestarts: sup.maxRestarts });
    supervisedChildren.delete(agentId);
    return;
  }

  // Count the ATTEMPT before spawning (not only on success): a child whose spawn
  // PERSISTENTLY fails must still be bounded by maxRestarts — otherwise it would
  // retry every tick forever (restartCount never advancing). maxRestarts bounds
  // total restart attempts; on exhaustion superviseTick's next pass gives up.
  sup.restartCount += 1;

  // For group strategies a still-alive sibling is restarted: terminate it first.
  if (pidManager.isProcessRunning(entry.pid)) {
    try { process.kill(entry.pid, "SIGKILL"); } catch { /* already gone */ }
  }
  const oldPid = entry.pid;
  const spawnOptions = {
    agentId,
    configPath: cfg.configPath,
    statePath: cfg.statePath,
    env: {
      ...(cfg.env ?? {}),
      ...(ctx.hmacKeyHex ? { OPENSTARRY_HMAC_KEY: ctx.hmacKeyHex } : {}),
    },
  };
  try {
    const result = await spawnDaemon(spawnOptions);
    pidToAgentMap.delete(oldPid);
    pidToAgentMap.set(result.pid, agentId);
    entry.pid = result.pid;
    entry.status = "running";
    entry.socketPath = result.socketPath;
    entry.logFile = result.logFile;
    agentStatuses.set(agentId, "running");
    console.error(`[daemon] supervisor: restarted "${agentId}" (pid ${oldPid} -> ${result.pid}, ${sup.restartCount}/${sup.maxRestarts})`);
    obs?.log?.info("agent:restarted", { agentId, oldPid, newPid: result.pid, restartCount: sup.restartCount });
  } catch (err) {
    // The attempt was already counted above, so a persistently-failing spawn is
    // bounded by maxRestarts rather than looping forever.
    console.error(`[daemon] supervisor: restart attempt ${sup.restartCount}/${sup.maxRestarts} of "${agentId}" failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

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
  // Supervisor: a gracefully-stopped child must NOT be restarted — drop its
  // supervision + retained spawn config.
  supervisedChildren.delete(agentId);
  childSpawnConfigs.delete(agentId);
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
  obs?.log?.info("daemon:shutdown", { signal, agentId: ctx?.agentId ?? null });

  if (!ctx) {
    console.error("[daemon] Context not initialized, exiting immediately");
    await obs?.flush("programmatic");
    process.exit(0);
  }

  try {
    // Stop the supervisor monitor (no restarts during our own shutdown).
    if (supervisorInterval) {
      clearInterval(supervisorInterval);
      supervisorInterval = null;
    }
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
      obs?.log?.info("agent:deregistered", { agentId: entry.agentId, reason: "cascade" });
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

    // ⑦ Flush observability buffers (structured-log 200 → audit-sink 300) so
    // lifecycle + denial records reach disk before exit. No-op when disabled.
    await obs?.flush(
      signal === "SIGTERM" ? "SIGTERM" : signal === "SIGINT" ? "SIGINT" : "programmatic"
    );

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
  listSessions: async () => (ctx ? ctx.persistence.listSessions(ctx.agentId) : []),
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
