/**
 * IPC Server Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync, mkdirSync, statSync } from "node:fs";
import { connect } from "node:net";
import { IPCServerImpl } from "../../src/daemon/ipc-server.js";
import type { RPCRequest } from "../../src/daemon/types.js";
import { isWindows, tryConnect, getDefaultSocketPath } from "../../src/daemon/platform.js";

describe("IPCServer", () => {
  let testDir: string;
  let socketPath: string;
  let server: IPCServerImpl;

  beforeEach(() => {
    testDir = join(tmpdir(), `ipc-server-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    socketPath = isWindows
      ? `\\\\.\\pipe\\openstarry-ipc-test-${Date.now()}`
      : join(testDir, "test.sock");
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("creates socket file on start", async () => {
    server = new IPCServerImpl({
      socketPath,
      onRequest: async () => ({ pong: true }),
    });

    await server.start();

    if (isWindows) {
      expect(await tryConnect(socketPath)).toBe(true);
    } else {
      expect(existsSync(socketPath)).toBe(true);
    }
  });

  it.skipIf(isWindows)("sets socket permissions to 0o600", async () => {
    server = new IPCServerImpl({
      socketPath,
      onRequest: async () => ({ pong: true }),
    });

    await server.start();

    const stats = statSync(socketPath);
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("removes socket file on stop", async () => {
    server = new IPCServerImpl({
      socketPath,
      onRequest: async () => ({ pong: true }),
    });

    await server.start();
    if (isWindows) {
      expect(await tryConnect(socketPath)).toBe(true);
    } else {
      expect(existsSync(socketPath)).toBe(true);
    }

    await server.stop();
    if (isWindows) {
      expect(await tryConnect(socketPath)).toBe(false);
    } else {
      expect(existsSync(socketPath)).toBe(false);
    }
  });

  it("calls onRequest handler for RPC requests", async () => {
    let receivedRequest: RPCRequest | null = null;

    server = new IPCServerImpl({
      socketPath,
      onRequest: async (req) => {
        receivedRequest = req;
        return { pong: true };
      },
    });

    await server.start();

    const client = connect(socketPath);
    const request = { id: 1, method: "test.ping" };
    client.write(JSON.stringify(request) + "\n");

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(receivedRequest).not.toBe(null);
    expect(receivedRequest?.method).toBe("test.ping");

    client.destroy();
  });

  it("handles multiple concurrent connections", async () => {
    server = new IPCServerImpl({
      socketPath,
      onRequest: async () => ({ pong: true }),
    });

    await server.start();

    const client1 = connect(socketPath);
    const client2 = connect(socketPath);

    const request1 = { id: 1, method: "test.ping" };
    const request2 = { id: 2, method: "test.ping" };

    client1.write(JSON.stringify(request1) + "\n");
    client2.write(JSON.stringify(request2) + "\n");

    await new Promise((resolve) => setTimeout(resolve, 100));

    client1.destroy();
    client2.destroy();
  });

  it("broadcasts events to all clients", async () => {
    server = new IPCServerImpl({
      socketPath,
      onRequest: async () => ({ pong: true }),
    });

    await server.start();

    const client1 = connect(socketPath);
    const client2 = connect(socketPath);

    const received1: string[] = [];
    const received2: string[] = [];

    client1.on("data", (data) => {
      received1.push(data.toString());
    });

    client2.on("data", (data) => {
      received2.push(data.toString());
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    server.broadcast({ event: "test", data: { msg: "hello" } });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(received1.length).toBeGreaterThan(0);
    expect(received2.length).toBeGreaterThan(0);

    client1.destroy();
    client2.destroy();
  });
});
