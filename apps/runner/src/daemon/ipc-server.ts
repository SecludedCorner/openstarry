/**
 * IPC Server — Unix domain socket server for daemon communication.
 *
 * Protocol: Line-delimited JSON (newline-separated messages).
 */

import { createServer, Server as NetServer, Socket } from "node:net";
import { existsSync, unlinkSync, chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { isNamedPipe } from "./platform.js";
import { randomUUID } from "node:crypto";
import type {
  IPCServer,
  IPCServerOptions,
  RPCRequest,
  RPCResponse,
  RPCEvent,
  RPCError,
} from "./types.js";
import { RPCErrorCode } from "./types.js";

/**
 * Client metadata for tracking attach state.
 */
interface ClientMetadata {
  clientId: string;
  attachedAt: number;
  sessionId: string | null;
  slowClientTimeout: NodeJS.Timeout | null;
}

/**
 * Implementation of IPC server using Unix domain sockets.
 */
export class IPCServerImpl implements IPCServer {
  private server: NetServer | null = null;
  private clients: Set<Socket> = new Set();
  private sessionSubscriptions = new Map<string, Set<Socket>>();
  public clientMetadata = new Map<Socket, ClientMetadata>();
  private readonly socketPath: string;
  private readonly onRequest: (req: RPCRequest, socket: Socket) => Promise<unknown>;

  constructor(options: IPCServerOptions) {
    this.socketPath = options.socketPath;
    this.onRequest = options.onRequest;
  }

  async start(): Promise<void> {
    // Cleanup stale socket file (not applicable for named pipes)
    if (!isNamedPipe(this.socketPath) && existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    // Create parent directory if needed (not applicable for named pipes)
    if (!isNamedPipe(this.socketPath)) {
      const dir = dirname(this.socketPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on("error", (err) => {
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        // Set socket permissions to owner-only (0o600) — not applicable on Windows
        if (process.platform !== "win32") {
          try {
            chmodSync(this.socketPath, 0o600);
          } catch (err) {
            console.error(`[ipc-server] Failed to set socket permissions: ${err}`);
          }
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // Close all client connections
    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();

    // Close server
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.server = null;

          // Remove socket file (not applicable for named pipes)
          if (!isNamedPipe(this.socketPath) && existsSync(this.socketPath)) {
            try {
              unlinkSync(this.socketPath);
            } catch (err) {
              console.error(`[ipc-server] Failed to remove socket: ${err}`);
            }
          }

          resolve();
        });
      });
    }
  }

  broadcast(event: RPCEvent): void {
    const message = JSON.stringify(event) + "\n";
    for (const client of this.clients) {
      if (!client.destroyed) {
        client.write(message);
      }
    }
  }

  /**
   * Broadcast event to all clients subscribed to a specific session.
   * Includes backpressure handling: disconnects slow clients after 5s timeout.
   */
  broadcastToSession(sessionId: string, event: RPCEvent): void {
    const subscribers = this.sessionSubscriptions.get(sessionId);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const message = JSON.stringify(event) + "\n";
    for (const client of subscribers) {
      if (client.destroyed) continue;

      const canWrite = client.write(message);
      if (!canWrite) {
        // Socket buffer full — start timeout
        const metadata = this.clientMetadata.get(client);
        if (metadata && !metadata.slowClientTimeout) {
          console.warn(`[ipc-server] Slow client detected: ${metadata.clientId}`);
          metadata.slowClientTimeout = setTimeout(() => {
            console.error(`[ipc-server] Disconnecting slow client: ${metadata.clientId}`);
            client.destroy();
          }, 5000); // 5 second timeout
        }
      } else {
        // Socket drained — clear timeout if exists
        const metadata = this.clientMetadata.get(client);
        if (metadata?.slowClientTimeout) {
          clearTimeout(metadata.slowClientTimeout);
          metadata.slowClientTimeout = null;
        }
      }
    }
  }

  /**
   * Subscribe a client socket to session events.
   */
  subscribeSession(socket: Socket, sessionId: string): void {
    let subscribers = this.sessionSubscriptions.get(sessionId);
    if (!subscribers) {
      subscribers = new Set();
      this.sessionSubscriptions.set(sessionId, subscribers);
    }
    subscribers.add(socket);

    // Update client metadata
    const metadata = this.clientMetadata.get(socket);
    if (metadata) {
      metadata.sessionId = sessionId;
    }
  }

  /**
   * Unsubscribe a client socket from session events.
   */
  unsubscribeSession(socket: Socket, sessionId: string): void {
    const subscribers = this.sessionSubscriptions.get(sessionId);
    if (subscribers) {
      subscribers.delete(socket);
      if (subscribers.size === 0) {
        this.sessionSubscriptions.delete(sessionId);
      }
    }
  }

  private handleConnection(socket: Socket): void {
    this.clients.add(socket);

    // Create client metadata
    const clientId = randomUUID();
    this.clientMetadata.set(socket, {
      clientId,
      attachedAt: Date.now(),
      sessionId: null,
      slowClientTimeout: null,
    });

    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString("utf-8");

      // Process complete messages (newline-delimited)
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        this.handleMessage(socket, line);
      }
    });

    socket.on("end", () => {
      this.cleanupSocket(socket);
    });

    socket.on("close", () => {
      this.cleanupSocket(socket);
    });

    socket.on("error", (err) => {
      console.error(`[ipc-server] Socket error: ${err}`);
      this.cleanupSocket(socket);
    });
  }

  private handleMessage(socket: Socket, line: string): void {
    let request: RPCRequest;

    try {
      const parsed: unknown = JSON.parse(line);
      request = parsed as RPCRequest;
    } catch {
      this.sendError(socket, 0, RPCErrorCode.PARSE_ERROR, "Invalid JSON");
      return;
    }

    // Validate request structure
    if (
      typeof request !== "object" ||
      request === null ||
      !("id" in request) ||
      !("method" in request)
    ) {
      this.sendError(socket, 0, RPCErrorCode.INVALID_REQUEST, "Invalid request structure");
      return;
    }

    // Handle request (pass socket for session subscription)
    this.onRequest(request, socket)
      .then((result) => {
        this.sendResponse(socket, request.id, result);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.sendError(socket, request.id, RPCErrorCode.INTERNAL_ERROR, message);
      });
  }

  private cleanupSocket(socket: Socket): void {
    this.clients.delete(socket);

    // Clear slow client timeout
    const metadata = this.clientMetadata.get(socket);
    if (metadata?.slowClientTimeout) {
      clearTimeout(metadata.slowClientTimeout);
    }
    this.clientMetadata.delete(socket);

    // Remove from all session subscriptions
    for (const [sessionId, subscribers] of this.sessionSubscriptions.entries()) {
      subscribers.delete(socket);
      if (subscribers.size === 0) {
        this.sessionSubscriptions.delete(sessionId);
      }
    }
  }

  private sendResponse(socket: Socket, id: string | number, result: unknown): void {
    const response: RPCResponse = { id, result };
    socket.write(JSON.stringify(response) + "\n");
  }

  private sendError(socket: Socket, id: string | number, code: number, message: string): void {
    const error: RPCError = { code, message };
    const response: RPCResponse = { id, error };
    socket.write(JSON.stringify(response) + "\n");
  }
}
