/**
 * SessionManager -- per-session conversation isolation.
 *
 * Each session owns an independent IStateManager. The default session
 * ("__default__") is created on construction and cannot be destroyed,
 * ensuring backward compatibility for sessionId-less inputs.
 */

import type { EventBus, ISession, ISessionManager, IStateManager } from "@openstarry/sdk";
import { AgentEventType } from "@openstarry/sdk";
import { createStateManager } from "../state/index.js";
import { createLogger } from "@openstarry/shared";
import crypto from "node:crypto";

const logger = createLogger("SessionManager");

const DEFAULT_SESSION_ID = "__default__";

interface SessionState {
  session: ISession;
  stateManager: IStateManager;
}

export function createSessionManager(bus: EventBus): ISessionManager {
  const sessions = new Map<string, SessionState>();

  // Create the default session immediately
  const defaultState: SessionState = {
    session: {
      id: DEFAULT_SESSION_ID,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
    },
    stateManager: createStateManager(),
  };
  sessions.set(DEFAULT_SESSION_ID, defaultState);

  const manager: ISessionManager = {
    create(metadata?: Record<string, unknown>): ISession {
      const id = crypto.randomUUID();
      const now = Date.now();
      const session: ISession = {
        id,
        createdAt: now,
        updatedAt: now,
        metadata: metadata ?? {},
      };
      const state: SessionState = {
        session,
        stateManager: createStateManager(),
      };
      sessions.set(id, state);

      bus.emit({
        type: AgentEventType.SESSION_CREATED,
        timestamp: now,
        payload: { sessionId: id, metadata: session.metadata },
      });

      return session;
    },

    get(sessionId: string): ISession | undefined {
      return sessions.get(sessionId)?.session;
    },

    list(): ISession[] {
      return Array.from(sessions.values()).map((s) => s.session);
    },

    destroy(sessionId: string): boolean {
      if (sessionId === DEFAULT_SESSION_ID) {
        logger.debug("Cannot destroy session", { sessionId, reason: "default session cannot be destroyed" });
        return false;
      }
      const state = sessions.get(sessionId);
      if (!state) {
        logger.debug("Cannot destroy session", { sessionId, reason: "session not found" });
        return false;
      }
      state.stateManager.clear();
      sessions.delete(sessionId);

      bus.emit({
        type: AgentEventType.SESSION_DESTROYED,
        timestamp: Date.now(),
        payload: { sessionId },
      });

      return true;
    },

    getStateManager(sessionId?: string): IStateManager {
      if (sessionId !== undefined) {
        const state = sessions.get(sessionId);
        if (state) {
          return state.stateManager;
        }
        logger.debug("Session not found, falling back to default", { sessionId });
      }
      return defaultState.stateManager;
    },

    getDefaultSession(): ISession {
      return defaultState.session;
    },
  };

  return manager;
}
