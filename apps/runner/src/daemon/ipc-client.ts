/**
 * IPC Client — Unix domain socket client for CLI commands.
 *
 * Protocol: Line-delimited JSON (newline-separated messages).
 */

import { connect, Socket } from "node:net";
import type {
  IPCClient,
  IPCClientOptions,
  RPCRequest,
  RPCResponse,
  RPCEvent,
} from "./types.js";

/**
 * Implementation of IPC client using Unix domain sockets.
 */
export class IPCClientImpl implements IPCClient {
  private socket: Socket | null = null;
  private readonly socketPath: string;
  private readonly timeoutMs: number;
  private buffer = "";
  private pendingRequests = new Map<
    string | number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private eventHandlers = new Map<string, Array<(data: unknown) => void>>();
  private nextRequestId = 1;

  constructor(options: IPCClientOptions) {
    this.socketPath = options.socketPath;
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = connect(this.socketPath);

      this.socket.on("connect", () => {
        resolve();
      });

      this.socket.on("error", (err) => {
        reject(err);
      });

      this.socket.on("data", (data) => {
        this.handleData(data);
      });

      this.socket.on("end", () => {
        this.cleanup();
        // Emit _close event for connection lost detection
        this.handleEvent({ event: "_close", data: null });
      });
    });
  }

  async call(method: string, params?: unknown): Promise<unknown> {
    if (!this.socket) {
      throw new Error("Client not connected");
    }

    const id = this.nextRequestId++;
    const request: RPCRequest = { id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC timeout after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      this.socket!.write(JSON.stringify(request) + "\n");
    });
  }

  close(): void {
    this.cleanup();
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  on(event: string, handler: (data: unknown) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  private handleData(data: Buffer): void {
    this.buffer += data.toString("utf-8");

    // Process complete messages (newline-delimited)
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      this.handleMessage(line);
    }
  }

  private handleMessage(line: string): void {
    try {
      const parsed: unknown = JSON.parse(line);

      // Check if it's an event notification
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "event" in parsed &&
        "data" in parsed
      ) {
        const event = parsed as RPCEvent;
        this.handleEvent(event);
        return;
      }

      // Otherwise, it's a response
      const response = parsed as RPCResponse;
      this.handleResponse(response);
    } catch (err) {
      console.error(`[ipc-client] Failed to parse message: ${err}`);
    }
  }

  private handleResponse(response: RPCResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      console.error(`[ipc-client] Received response for unknown request ID: ${response.id}`);
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }

  private handleEvent(event: RPCEvent): void {
    const handlers = this.eventHandlers.get(event.event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event.data);
        } catch (err) {
          console.error(`[ipc-client] Event handler error: ${err}`);
        }
      }
    }
  }

  private cleanup(): void {
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Connection closed"));
    }
    this.pendingRequests.clear();
  }
}
