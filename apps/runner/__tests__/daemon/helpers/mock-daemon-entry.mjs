/**
 * Mock daemon entry point for testing.
 * Simulates daemon behavior without requiring AgentCore or LLM provider.
 *
 * Reads: --pid-file, --socket, --agent-id, --log-file
 * Provides: PID file writing, IPC server (ping/status/stop), SIGTERM handling
 */

import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { dirname } from "node:path";

// Parse args
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : null;
}

const agentId = getArg("agent-id") || "test";
const pidFile = getArg("pid-file");
const socketPath = getArg("socket");
const logFile = getArg("log-file");

if (!pidFile || !socketPath) {
  console.error("[mock-daemon] Missing --pid-file or --socket");
  process.exit(1);
}

// Ensure directories exist
mkdirSync(dirname(pidFile), { recursive: true });
if (!socketPath.startsWith("\\\\.\\pipe\\")) {
  mkdirSync(dirname(socketPath), { recursive: true });
}

// Write PID file
writeFileSync(pidFile, process.pid.toString(), "utf-8");

const startTime = Date.now();
let shuttingDown = false;

// Create IPC server
const server = createServer((socket) => {
  let buffer = "";

  socket.on("data", (data) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const req = JSON.parse(line);
        const response = handleRequest(req);
        socket.write(JSON.stringify(response) + "\n");
      } catch (err) {
        socket.write(JSON.stringify({
          id: 0,
          error: { code: -32700, message: "Parse error" },
        }) + "\n");
      }
    }
  });
});

function handleRequest(req) {
  switch (req.method) {
    case "agent.ping":
      return { id: req.id, result: { pong: true } };
    case "agent.status":
      return {
        id: req.id,
        result: {
          agentId,
          pid: process.pid,
          status: "running",
          uptime: Math.floor((Date.now() - startTime) / 1000),
          configPath: getArg("config") || "",
          logFile: logFile || "",
          socketPath,
        },
      };
    case "agent.stop":
      setImmediate(() => shutdown("RPC"));
      return { id: req.id, result: { success: true } };
    case "daemon.health":
      return {
        id: req.id,
        result: {
          uptime: Math.floor((Date.now() - startTime) / 1000),
          version: "0.1.0",
        },
      };
    default:
      return {
        id: req.id,
        error: { code: -32601, message: `Unknown method: ${req.method}` },
      };
  }
}

// Remove stale socket file (not applicable for named pipes)
if (!socketPath.startsWith("\\\\.\\pipe\\") && existsSync(socketPath)) {
  unlinkSync(socketPath);
}

server.listen(socketPath, () => {
  console.error(`[mock-daemon] IPC server listening on ${socketPath}`);
  console.error(`[mock-daemon] PID ${process.pid} ready`);
});

// Signal handling
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[mock-daemon] Received ${signal}, shutting down...`);

  server.close(() => {
    if (!socketPath.startsWith("\\\\.\\pipe\\")) {
      try { unlinkSync(socketPath); } catch {}
    }
    try { unlinkSync(pidFile); } catch {}
    console.error("[mock-daemon] Shutdown complete");
    process.exit(0);
  });

  // Force exit after 5s
  setTimeout(() => process.exit(0), 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
if (process.platform !== "win32") {
  process.on("SIGHUP", () => shutdown("SIGHUP"));
}

// Keep alive
setInterval(() => {}, 60000);
