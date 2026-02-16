/**
 * Platform utilities for cross-platform daemon IPC.
 *
 * On Windows, Unix domain sockets are not supported.
 * Named pipes (\\.\pipe\name) are used instead.
 */

import { existsSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const isWindows = process.platform === "win32";

function simpleHash(input: string): string {
  return createHash("md5").update(input).digest("hex").slice(0, 8);
}

export function getDefaultSocketPath(agentId: string, statePath: string): string {
  if (isWindows) {
    const hash = simpleHash(statePath);
    return `\\\\.\\pipe\\openstarry-${agentId}-${hash}`;
  }
  return join(statePath, "sockets", `${agentId}.sock`);
}

export function isNamedPipe(socketPath: string): boolean {
  return socketPath.startsWith("\\\\.\\pipe\\");
}

export async function waitForEndpoint(path: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isNamedPipe(path)) {
      const connected = await tryConnect(path);
      if (connected) return;
    } else {
      if (existsSync(path)) return;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Timeout waiting for endpoint: ${path}`);
}

export function tryConnect(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const client = connect(path, () => {
      client.destroy();
      resolve(true);
    });
    client.on("error", () => resolve(false));
  });
}
