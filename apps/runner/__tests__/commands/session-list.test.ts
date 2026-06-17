/**
 * /session list + agent.list-sessions Tests (Doc 26, v0.59.7-alpha).
 *
 * Two layers:
 *  1. RPC round-trip — the real FileSessionPersistence producer surfaced over
 *     the real IPC server/client, asserting SessionIndexEntry[] serializes and
 *     returns. The daemon's `agent.list-sessions` switch arm delegates to
 *     exactly `ctx.persistence.listSessions(ctx.agentId)`; the _controlPlane
 *     completeness for listSessions is enforced at compile time (pnpm build).
 *  2. AttachCommand.listSessions — the REPL renderer that replaced the
 *     "not yet implemented" stub, with the client injected.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { IPCServerImpl } from "../../src/daemon/ipc-server.js";
import { IPCClientImpl } from "../../src/daemon/ipc-client.js";
import { isWindows } from "../../src/daemon/platform.js";
import { FileSessionPersistence } from "../../src/daemon/session-persistence.js";
import type { SessionIndexEntry } from "../../src/daemon/session-persistence.js";
import type { RPCRequest } from "../../src/daemon/types.js";
import type { ISession } from "@openstarry/sdk";
import { AttachCommand } from "../../src/commands/attach.js";

describe("agent.list-sessions RPC round-trip (real producer)", () => {
  let testDir: string;
  let socketPath: string;
  let server: IPCServerImpl;
  let client: IPCClientImpl;
  let persistence: FileSessionPersistence;
  const agentId = "list-sessions-agent";

  beforeEach(() => {
    testDir = join(tmpdir(), `session-list-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(testDir, { recursive: true });
    if (isWindows) {
      const hash = createHash("md5").update(testDir).digest("hex").slice(0, 8);
      socketPath = `\\\\.\\pipe\\session-list-${hash}`;
    } else {
      socketPath = join(testDir, "test.sock");
    }
    persistence = new FileSessionPersistence(testDir, 1000);
  });

  afterEach(async () => {
    if (client) client.close();
    if (server) await server.stop();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  async function saveSession(id: string): Promise<void> {
    const session: ISession = { id, createdAt: Date.now(), updatedAt: Date.now(), metadata: {} };
    // 5 saves to bypass debounce (immediate flush).
    for (let i = 0; i < 5; i++) {
      await persistence.save(agentId, session, []);
    }
  }

  it("returns persisted SessionIndexEntry[] over IPC", async () => {
    await saveSession("session-a");
    await saveSession("session-b");

    // Mirror the daemon's agent.list-sessions arm exactly.
    server = new IPCServerImpl({
      socketPath,
      onRequest: async (req: RPCRequest) => {
        if (req.method === "agent.list-sessions") {
          return persistence.listSessions(agentId);
        }
        return {};
      },
    });
    await server.start();

    client = new IPCClientImpl({ socketPath });
    await client.connect();

    const sessions = (await client.call("agent.list-sessions")) as SessionIndexEntry[];
    expect(sessions).toHaveLength(2);
    const ids = sessions.map((s) => s.id).sort();
    expect(ids).toEqual(["session-a", "session-b"]);
    for (const s of sessions) {
      expect(typeof s.updatedAt).toBe("number");
      expect(typeof s.messageCount).toBe("number");
    }
  });

  it("returns empty array when no sessions persisted", async () => {
    server = new IPCServerImpl({
      socketPath,
      onRequest: async (req: RPCRequest) =>
        req.method === "agent.list-sessions" ? persistence.listSessions(agentId) : {},
    });
    await server.start();

    client = new IPCClientImpl({ socketPath });
    await client.connect();

    const sessions = (await client.call("agent.list-sessions")) as SessionIndexEntry[];
    expect(sessions).toEqual([]);
  });
});

describe("AttachCommand.listSessions — /session list renderer", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  function makeCmd(callImpl: (method: string) => Promise<unknown>, currentSession: string | null) {
    const cmd = new AttachCommand();
    (cmd as unknown as { client: unknown }).client = { call: vi.fn(callImpl) };
    (cmd as unknown as { sessionId: string | null }).sessionId = currentSession;
    return cmd as unknown as { listSessions: () => Promise<void> };
  }

  it("renders persisted sessions sorted newest-first, marking the current one", async () => {
    const entries: SessionIndexEntry[] = [
      { id: "old-session", createdAt: 1000, updatedAt: 1000, metadata: {}, messageCount: 3 },
      { id: "new-session", createdAt: 2000, updatedAt: 5000, metadata: {}, messageCount: 7 },
    ];
    const cmd = makeCmd(async () => entries, "new-session");

    await cmd.listSessions();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Non-stub: must NOT contain the old placeholder.
    expect(output).not.toContain("not yet implemented");
    expect(output).toContain("new-session");
    expect(output).toContain("old-session");
    // newest-first ordering
    const lines = output.split("\n");
    const newIdx = lines.findIndex((l) => l.includes("new-session"));
    const oldIdx = lines.findIndex((l) => l.includes("old-session"));
    expect(newIdx).toBeLessThan(oldIdx);
    // current-session marker
    expect(lines[newIdx].startsWith("*")).toBe(true);
    expect(output).toContain("2 session(s)");
  });

  it("reports no sessions when the list is empty", async () => {
    const cmd = makeCmd(async () => [], null);
    await cmd.listSessions();
    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("No persisted sessions.");
  });

  it("surfaces an RPC error without throwing", async () => {
    const cmd = makeCmd(async () => {
      throw new Error("daemon gone");
    }, null);
    await expect(cmd.listSessions()).resolves.toBeUndefined();
    const errOut = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(errOut).toContain("Failed to list sessions");
  });
});
