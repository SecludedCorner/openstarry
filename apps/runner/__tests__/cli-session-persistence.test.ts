/**
 * B⑦ (2026-06-15): foreground CLI conversation history persistence.
 *
 * Proves saveCliSessions + restoreCliSession round-trip the default ("__default__")
 * session through the daemon's FileSessionPersistence store — closing the ledger #9
 * boundary that CLI history was memory-only / lost on exit.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@openstarry/sdk";
import { createSessionManager } from "@openstarry/core";
import { FileSessionPersistence } from "../src/daemon/session-persistence.js";
import { saveCliSessions, restoreCliSession } from "../src/utils/cli-session-persistence.js";

const stubBus = { emit: () => {} } as unknown as Parameters<typeof createSessionManager>[0];
const MESSAGES = [
  { role: "user", content: "hello" },
  { role: "assistant", content: "hi there" },
] as unknown as Message[];

describe("B⑦ CLI session persistence (default-session round-trip)", () => {
  it("saveCliSessions persists the non-empty default session; restoreCliSession reloads it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-cli-sess-"));
    try {
      const persistence = new FileSessionPersistence(dir);
      const agentId = "cli-agent";

      // Session A: inject history into the default session, save.
      const smA = createSessionManager(stubBus);
      const def = smA.getDefaultSession();
      smA.getStateManager(def.id).restore(MESSAGES);
      const saved = await saveCliSessions(persistence, agentId, smA);
      expect(saved).toBe(1);

      // Session B: a fresh manager (simulating a new process) restores via --resume.
      const smB = createSessionManager(stubBus);
      expect(smB.getStateManager(smB.getDefaultSession().id).getMessages()).toHaveLength(0);
      const restored = await restoreCliSession(persistence, agentId, smB);
      expect(restored).toBe(MESSAGES.length);
      const reloaded = smB.getStateManager(smB.getDefaultSession().id).getMessages();
      expect(reloaded).toHaveLength(2);
      expect((reloaded[0] as { content: string }).content).toBe("hello");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saveCliSessions skips empty sessions (no file written, returns 0)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-cli-sess-"));
    try {
      const persistence = new FileSessionPersistence(dir);
      const sm = createSessionManager(stubBus);
      const saved = await saveCliSessions(persistence, "empty-agent", sm);
      expect(saved).toBe(0);
      expect(existsSync(join(dir, "empty-agent"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restoreCliSession returns 0 when no history is persisted (fresh start)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-cli-sess-"));
    try {
      const persistence = new FileSessionPersistence(dir);
      const sm = createSessionManager(stubBus);
      const restored = await restoreCliSession(persistence, "never-saved", sm);
      expect(restored).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saveNow writes immediately (no debounce) — file present right after the call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-cli-sess-"));
    try {
      const persistence = new FileSessionPersistence(dir);
      const sm = createSessionManager(stubBus);
      const def = sm.getDefaultSession();
      sm.getStateManager(def.id).restore(MESSAGES);
      await saveCliSessions(persistence, "now-agent", sm);
      // immediate: the messages file exists synchronously after await (no 10s debounce wait)
      expect(existsSync(join(dir, "now-agent", `${def.id}.messages.json`))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
