/**
 * Session types for isolated conversation contexts.
 */

import type { IStateManager } from "../interfaces/state.js";

/**
 * Session entity -- represents an isolated conversation context.
 */
export interface ISession {
  /** Unique session identifier (crypto.randomUUID()). */
  readonly id: string;
  /** Timestamp (ms) when the session was created. */
  readonly createdAt: number;
  /** Timestamp (ms) of the last activity in this session. */
  updatedAt: number;
  /** Arbitrary metadata attached to the session by the transport or client. */
  metadata: Record<string, unknown>;
}

/**
 * Session manager interface -- SDK contract for session lifecycle.
 * Implementation lives in packages/core.
 */
export interface ISessionManager {
  /** Create a new session. Returns the created session. */
  create(metadata?: Record<string, unknown>): ISession;

  /** Retrieve a session by ID. Returns undefined if not found. */
  get(sessionId: string): ISession | undefined;

  /** List all active sessions. */
  list(): ISession[];

  /** Destroy a session and its associated state. */
  destroy(sessionId: string): boolean;

  /**
   * Get the IStateManager for a specific session.
   * If sessionId is undefined or not found, returns the default session's state manager.
   */
  getStateManager(sessionId?: string): IStateManager;

  /** Get the default session (always exists, used for backward compatibility). */
  getDefaultSession(): ISession;
}

/**
 * Typed session configuration.
 * Stored in ISession.metadata.config for type-safe access.
 */
export interface SessionConfig {
  /**
   * Filesystem paths this session can access.
   * Overrides agent-level allowedPaths when specified.
   * Used by MCP Roots handler and sandboxed tools.
   */
  allowedPaths?: string[];

  /** Per-session model override. Takes precedence over global model selection. */
  model?: string;

  /** Per-session provider override. Takes precedence over global provider selection. */
  provider?: string;

  /**
   * Session-specific metadata (extensible for future use).
   * Examples: maxHistorySize, sessionTTL, customHeaders.
   */
  [key: string]: unknown;
}

/**
 * Extract typed SessionConfig from session metadata.
 * Returns undefined if no config is present.
 *
 * @example
 * const session = ctx.sessions.get(sessionId);
 * const config = getSessionConfig(session?.metadata);
 * const paths = config?.allowedPaths ?? [ctx.workingDirectory];
 */
export function getSessionConfig(
  metadata?: Record<string, unknown>,
): SessionConfig | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  return metadata.config as SessionConfig | undefined;
}

/**
 * Store typed SessionConfig into session metadata.
 * Mutates the metadata object in-place.
 *
 * @example
 * const metadata = {};
 * setSessionConfig(metadata, { allowedPaths: ["/project/root"] });
 * const session = ctx.sessions.create(metadata);
 */
export function setSessionConfig(
  metadata: Record<string, unknown>,
  config: SessionConfig,
): void {
  metadata.config = config;
}
