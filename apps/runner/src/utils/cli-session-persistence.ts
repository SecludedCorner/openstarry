/**
 * cli-session-persistence — foreground (CLI) conversation history persistence.
 *
 * GAP-2026-06-15 (ledger #9 boundary): session save/load existed only on the
 * daemon path (daemon-entry calls ctx.persistence). The foreground `start`
 * command kept conversation history in memory only, so a CLI REPL's history was
 * lost on exit. These helpers wire the SAME FileSessionPersistence store into
 * the CLI lifecycle: save all live sessions at shutdown, and (with --resume)
 * restore the default session's history at startup.
 *
 * In CLI/stdio mode every input arrives without a sessionId, so the core routes
 * it to the default session ("__default__"). Restoring into that session's state
 * manager before core.start() means the next REPL turn continues prior history.
 *
 * Layer: runner-local (Tenet #2 / MR-6 — Core never sees persistence paths).
 */

import type { ISessionManager } from "@openstarry/sdk";
import type { ISessionPersistence } from "../daemon/session-persistence.js";

/**
 * Persist every live session that has at least one message — including the
 * default CLI session — using the immediate (non-debounced) save so the write
 * completes before the process exits. Returns the number of sessions saved.
 */
export async function saveCliSessions(
  persistence: ISessionPersistence,
  agentId: string,
  sessions: ISessionManager,
): Promise<number> {
  let saved = 0;
  for (const session of sessions.list()) {
    const messages = sessions.getStateManager(session.id).getMessages();
    if (messages.length === 0) continue; // don't persist empty sessions
    await persistence.saveNow(agentId, session, messages);
    saved++;
  }
  return saved;
}

/**
 * Restore the default CLI session's history from disk into the live default
 * session's state manager (the session all no-sessionId stdio input flows into).
 * Returns the number of messages restored (0 if none persisted). Fail-soft: a
 * load error leaves the session empty (fresh-start), never throws.
 */
export async function restoreCliSession(
  persistence: ISessionPersistence,
  agentId: string,
  sessions: ISessionManager,
): Promise<number> {
  const def = sessions.getDefaultSession();
  let data: Awaited<ReturnType<ISessionPersistence["load"]>> = null;
  try {
    data = await persistence.load(agentId, def.id);
  } catch {
    return 0;
  }
  if (!data || data.messages.length === 0) return 0;
  sessions.getStateManager(def.id).restore(data.messages);
  return data.messages.length;
}
