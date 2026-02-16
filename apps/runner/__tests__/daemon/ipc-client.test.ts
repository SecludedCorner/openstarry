/**
 * IPC Client Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { IPCServerImpl } from "../../src/daemon/ipc-server.js";
import { IPCClientImpl } from "../../src/daemon/ipc-client.js";
import { isWindows } from "../../src/daemon/platform.js";
import type { RPCRequest } from "../../src/daemon/types.js";

describe("IPCClient", () => {
  let testDir: string;
  let socketPath: string;
  let server: IPCServerImpl;
  let client: IPCClientImpl;

  beforeEach(() => {
    testDir = join(tmpdir(), `ipc-client-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    if (isWindows) {
      const hash = createHash("md5").update(testDir).digest("hex").slice(0, 8);
      socketPath = `\\\\.\\pipe\\ipc-client-test-${hash}`;
    } else {
      socketPath = join(testDir, "test.sock");
    }
  });

  afterEach(async () => {
    if (client) {
      client.close();
    }
    if (server) {
      await server.stop();
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("connects to socket successfully", async () => {
    server = new IPCServerImpl({
      socketPath,
      onRequest: async () => ({ pong: true }),
    });
    await server.start();

    client = new IPCClientImpl({ socketPath });
    await client.connect();

    expect(client).toBeDefined();
  });

  it("sends request and receives response", async () => {
    server = new IPCServerImpl({
      socketPath,
      onRequest: async (req: RPCRequest) => {
        if (req.method === "test.ping") {
          return { pong: true };
        }
        return {};
      },
    });
    await server.start();

    client = new IPCClientImpl({ socketPath });
    await client.connect();

    const result = await client.call("test.ping");
    expect(result).toEqual({ pong: true });
  });

  it("rejects on timeout", async () => {
    server = new IPCServerImpl({
      socketPath,
      onRequest: async () => {
        // Never respond
        await new Promise(() => {});
        return {};
      },
    });
    await server.start();

    client = new IPCClientImpl({ socketPath, timeoutMs: 100 });
    await client.connect();

    await expect(client.call("test.slow")).rejects.toThrow(/timeout/i);
  });

  it("closes connection cleanly", async () => {
    server = new IPCServerImpl({
      socketPath,
      onRequest: async () => ({ pong: true }),
    });
    await server.start();

    client = new IPCClientImpl({ socketPath });
    await client.connect();

    expect(() => client.close()).not.toThrow();
  });

  it("receives events from server", async () => {
    server = new IPCServerImpl({
      socketPath,
      onRequest: async () => ({ pong: true }),
    });
    await server.start();

    client = new IPCClientImpl({ socketPath });
    await client.connect();

    const receivedEvents: unknown[] = [];

    client.on("test", (data) => {
      receivedEvents.push(data);
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    server.broadcast({ event: "test", data: { msg: "hello" } });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(receivedEvents.length).toBeGreaterThan(0);
  });

  it("errors when socket doesn't exist", async () => {
    client = new IPCClientImpl({ socketPath: join(testDir, "nonexistent.sock") });

    await expect(client.connect()).rejects.toThrow();
  });
});
