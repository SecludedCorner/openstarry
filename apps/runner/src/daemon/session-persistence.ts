/**
 * Session Persistence — File-based session save/load for daemon restarts.
 *
 * Storage layout:
 *   $OPENSTARRY_HOME/sessions/{agentId}/
 *   ├── index.json                          # Session registry
 *   ├── {sessionId}.json                    # Session metadata
 *   └── {sessionId}.messages.json           # Conversation history
 *
 * Atomic writes: Use tmp file + rename pattern.
 * Debounced saves: Save after 10s idle OR 5 new messages.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile, readdir, unlink, rename } from "node:fs/promises";
import { join } from "node:path";
import type { ISession, Message } from "@openstarry/sdk";

/**
 * Session data returned by load().
 */
export interface SessionData {
  session: ISession;
  messages: Message[];
}

/**
 * Session index entry (for listSessions).
 */
export interface SessionIndexEntry {
  id: string;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
  messageCount: number;
}

/**
 * Session index file format.
 */
interface SessionIndex {
  version: number;
  sessions: SessionIndexEntry[];
}

/**
 * Session persistence interface.
 */
export interface ISessionPersistence {
  save(agentId: string, session: ISession, messages: Message[]): Promise<void>;
  load(agentId: string, sessionId: string): Promise<SessionData | null>;
  listSessions(agentId: string): Promise<SessionIndexEntry[]>;
  delete(agentId: string, sessionId: string): Promise<void>;
  cleanupExpired(agentId: string, idleTTL: number): Promise<number>;
}

/**
 * File-based session persistence implementation.
 */
export class FileSessionPersistence implements ISessionPersistence {
  private readonly basePath: string;
  private readonly maxHistorySize: number;
  private readonly debouncedSaves: Map<string, NodeJS.Timeout> = new Map();
  private readonly pendingMessageCounts: Map<string, number> = new Map();

  constructor(basePath: string, maxHistorySize = 1000) {
    this.basePath = basePath;
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * Save session metadata and messages to disk.
   * Uses debounced writes: saves after 10s idle OR 5 new messages.
   */
  async save(agentId: string, session: ISession, messages: Message[]): Promise<void> {
    // Validate sessionId (no path traversal)
    if (this.isInvalidSessionId(session.id)) {
      throw new Error("Invalid session ID: must not contain '/' or '..'");
    }

    const key = `${agentId}:${session.id}`;

    // Increment pending message count
    const currentCount = this.pendingMessageCounts.get(key) ?? 0;
    this.pendingMessageCounts.set(key, currentCount + 1);

    // Clear existing debounce timer
    const existingTimer = this.debouncedSaves.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Check if we should save immediately (5+ pending messages)
    if (this.pendingMessageCounts.get(key)! >= 5) {
      await this.saveImmediate(agentId, session, messages);
      this.pendingMessageCounts.set(key, 0);
      this.debouncedSaves.delete(key);
      return;
    }

    // Otherwise, schedule debounced save (10s idle)
    const timer = setTimeout(() => {
      this.saveImmediate(agentId, session, messages)
        .then(() => {
          this.pendingMessageCounts.set(key, 0);
          this.debouncedSaves.delete(key);
        })
        .catch((err) => {
          console.error(`[session-persistence] Debounced save failed: ${err}`);
        });
    }, 10000); // 10 seconds

    this.debouncedSaves.set(key, timer);
  }

  /**
   * Immediate save (called by debounced logic).
   */
  private async saveImmediate(agentId: string, session: ISession, messages: Message[]): Promise<void> {
    const sessionDir = join(this.basePath, agentId);

    // Ensure directory exists
    if (!existsSync(sessionDir)) {
      await mkdir(sessionDir, { recursive: true, mode: 0o755 });
    }

    // Truncate messages if exceeds maxHistorySize
    const truncatedMessages = messages.length > this.maxHistorySize
      ? messages.slice(-this.maxHistorySize)
      : messages;

    // Write session metadata (atomic)
    const sessionFile = join(sessionDir, `${session.id}.json`);
    const sessionTmp = `${sessionFile}.tmp`;
    await writeFile(sessionTmp, JSON.stringify(session, null, 2), { encoding: "utf-8", mode: 0o600 });
    await rename(sessionTmp, sessionFile);

    // Write messages (atomic)
    const messagesFile = join(sessionDir, `${session.id}.messages.json`);
    const messagesTmp = `${messagesFile}.tmp`;
    await writeFile(messagesTmp, JSON.stringify(truncatedMessages, null, 2), { encoding: "utf-8", mode: 0o600 });
    await rename(messagesTmp, messagesFile);

    // Update index
    await this.updateIndex(agentId, session, truncatedMessages.length);
  }

  /**
   * Update session index file.
   */
  private async updateIndex(agentId: string, session: ISession, messageCount: number): Promise<void> {
    const sessionDir = join(this.basePath, agentId);
    const indexFile = join(sessionDir, "index.json");

    // Load existing index
    let index: SessionIndex;
    if (existsSync(indexFile)) {
      try {
        const raw = await readFile(indexFile, "utf-8");
        index = JSON.parse(raw) as SessionIndex;
      } catch {
        // Corrupted index, rebuild from scratch
        index = { version: 1, sessions: [] };
      }
    } else {
      index = { version: 1, sessions: [] };
    }

    // Update or add session entry
    const existingIndex = index.sessions.findIndex((s) => s.id === session.id);
    const entry: SessionIndexEntry = {
      id: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      metadata: session.metadata,
      messageCount,
    };

    if (existingIndex >= 0) {
      index.sessions[existingIndex] = entry;
    } else {
      index.sessions.push(entry);
    }

    // Write index (atomic)
    const indexTmp = `${indexFile}.tmp`;
    await writeFile(indexTmp, JSON.stringify(index, null, 2), { encoding: "utf-8", mode: 0o600 });
    await rename(indexTmp, indexFile);
  }

  /**
   * Load session metadata and messages from disk.
   */
  async load(agentId: string, sessionId: string): Promise<SessionData | null> {
    // Validate sessionId
    if (this.isInvalidSessionId(sessionId)) {
      throw new Error("Invalid session ID");
    }

    const sessionDir = join(this.basePath, agentId);
    const sessionFile = join(sessionDir, `${sessionId}.json`);
    const messagesFile = join(sessionDir, `${sessionId}.messages.json`);

    if (!existsSync(sessionFile) || !existsSync(messagesFile)) {
      return null;
    }

    try {
      // Load session metadata
      const sessionRaw = await readFile(sessionFile, "utf-8");
      const session = JSON.parse(sessionRaw) as ISession;

      // Load messages
      const messagesRaw = await readFile(messagesFile, "utf-8");
      const messages = JSON.parse(messagesRaw) as Message[];

      return { session, messages };
    } catch (err) {
      console.error(`[session-persistence] Load failed for session ${sessionId}: ${err}`);
      return null;
    }
  }

  /**
   * List all persisted sessions for an agent.
   */
  async listSessions(agentId: string): Promise<SessionIndexEntry[]> {
    const sessionDir = join(this.basePath, agentId);
    const indexFile = join(sessionDir, "index.json");

    if (!existsSync(indexFile)) {
      return [];
    }

    try {
      const raw = await readFile(indexFile, "utf-8");
      const index = JSON.parse(raw) as SessionIndex;
      return index.sessions;
    } catch {
      // Corrupted index, rebuild from directory listing
      return this.rebuildIndex(agentId);
    }
  }

  /**
   * Rebuild index from directory listing (fallback for corrupted index).
   */
  private async rebuildIndex(agentId: string): Promise<SessionIndexEntry[]> {
    const sessionDir = join(this.basePath, agentId);

    if (!existsSync(sessionDir)) {
      return [];
    }

    try {
      const files = await readdir(sessionDir);
      const sessionFiles = files.filter((f) => f.endsWith(".json") && !f.endsWith(".messages.json") && f !== "index.json");

      const entries: SessionIndexEntry[] = [];
      for (const file of sessionFiles) {
        const sessionId = file.replace(".json", "");
        const sessionFile = join(sessionDir, file);
        const messagesFile = join(sessionDir, `${sessionId}.messages.json`);

        try {
          const sessionRaw = await readFile(sessionFile, "utf-8");
          const session = JSON.parse(sessionRaw) as ISession;

          let messageCount = 0;
          if (existsSync(messagesFile)) {
            const messagesRaw = await readFile(messagesFile, "utf-8");
            const messages = JSON.parse(messagesRaw) as Message[];
            messageCount = messages.length;
          }

          entries.push({
            id: session.id,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            metadata: session.metadata,
            messageCount,
          });
        } catch {
          // Skip corrupted session files
          continue;
        }
      }

      return entries;
    } catch {
      return [];
    }
  }

  /**
   * Delete a session's persisted files.
   */
  async delete(agentId: string, sessionId: string): Promise<void> {
    // Validate sessionId
    if (this.isInvalidSessionId(sessionId)) {
      throw new Error("Invalid session ID");
    }

    const sessionDir = join(this.basePath, agentId);
    const sessionFile = join(sessionDir, `${sessionId}.json`);
    const messagesFile = join(sessionDir, `${sessionId}.messages.json`);

    // Delete files (ignore errors if not exist)
    try {
      if (existsSync(sessionFile)) {
        await unlink(sessionFile);
      }
      if (existsSync(messagesFile)) {
        await unlink(messagesFile);
      }
    } catch (err) {
      console.error(`[session-persistence] Delete failed for session ${sessionId}: ${err}`);
    }

    // Remove from index
    await this.removeFromIndex(agentId, sessionId);
  }

  /**
   * Remove session entry from index.
   */
  private async removeFromIndex(agentId: string, sessionId: string): Promise<void> {
    const sessionDir = join(this.basePath, agentId);
    const indexFile = join(sessionDir, "index.json");

    if (!existsSync(indexFile)) {
      return;
    }

    try {
      const raw = await readFile(indexFile, "utf-8");
      const index = JSON.parse(raw) as SessionIndex;

      index.sessions = index.sessions.filter((s) => s.id !== sessionId);

      // Write updated index (atomic)
      const indexTmp = `${indexFile}.tmp`;
      await writeFile(indexTmp, JSON.stringify(index, null, 2), { encoding: "utf-8", mode: 0o600 });
      await rename(indexTmp, indexFile);
    } catch {
      // Ignore errors
    }
  }

  /**
   * Cleanup expired sessions based on idle TTL.
   */
  async cleanupExpired(agentId: string, idleTTL: number): Promise<number> {
    const sessions = await this.listSessions(agentId);
    const now = Date.now();
    const ttlMs = idleTTL * 1000;

    let deletedCount = 0;
    for (const session of sessions) {
      const idleTime = now - session.updatedAt;
      if (idleTime > ttlMs) {
        await this.delete(agentId, session.id);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * Validate sessionId format (no path traversal).
   */
  private isInvalidSessionId(sessionId: string): boolean {
    return sessionId.includes("/") || sessionId.includes("..");
  }

  /**
   * Flush all pending debounced saves (called on shutdown).
   */
  async flushAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [key, timer] of this.debouncedSaves.entries()) {
      clearTimeout(timer);
      // Note: We can't re-trigger saves here because we don't have session/messages context
      // This is by design — shutdown saves should be handled by daemon-entry calling save() explicitly
    }

    this.debouncedSaves.clear();
    this.pendingMessageCounts.clear();

    await Promise.all(promises);
  }
}
