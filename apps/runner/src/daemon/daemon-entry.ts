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
import { pathToFileURL } from "node:url";
import type { Socket } from "node:net";
import type { IAgentConfig, InputEvent } from "@openstarry/sdk";
import { createAgentCore } from "@openstarry/core";
import { parseArgs } from "../utils/args.js";
import { validateConfig } from "../utils/config-validator.js";
import { resolvePlugins } from "../utils/plugin-resolver.js";
import { IPCServerImpl } from "./ipc-server.js";
import { pidManager } from "./pid-manager.js";
import type { RPCRequest, AgentStatus, AttachOptions, AttachResult, InputMessage, DetachMessage, ListClientsResult, ClientInfo } from "./types.js";
import { RPCErrorCode } from "./types.js";
import { initEventForwarder } from "./event-forwarder.js";
import { FileSessionPersistence } from "./session-persistence.js";
import { SESSIONS_DIR } from "../bootstrap.js";

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
}

let ctx: DaemonContext | null = null;
let shuttingDown = false;
let eventForwarderUnsub: (() => void) | null = null;

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

    // 4. Load plugins
    const pluginResult = await resolvePlugins(config, false);
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

    default:
      throw {
        code: RPCErrorCode.METHOD_NOT_FOUND,
        message: `Unknown method: ${req.method}`,
      };
  }
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

// Run if called directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[daemon] Fatal error: ${err}`);
    process.exit(1);
  });
}
