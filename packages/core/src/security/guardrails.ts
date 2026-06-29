/**
 * SecurityLayer — tool call interception, path safety, guardrails.
 */

import { resolve, normalize } from "node:path";
import { lstatSync } from "node:fs";
import { SecurityError, SessionConfig, getSessionConfig } from "@openstarry/sdk";
import { createLogger, safeRealpath, isWithinRoots } from "@openstarry/shared";

const logger = createLogger("Security");

/**
 * Check if a path is a symbolic link using lstatSync.
 * Returns false on any error (e.g., path does not exist).
 */
export function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Check if targetPath is safely within basePath (no traversal).
 */
export function isPathSafe(basePath: string, targetPath: string): boolean {
  const resolvedBase = resolve(normalize(basePath));
  const resolvedTarget = resolve(normalize(targetPath));
  return resolvedTarget === resolvedBase ||
    resolvedTarget.startsWith(resolvedBase + "/") ||
    resolvedTarget.startsWith(resolvedBase + "\\");
}

export interface SecurityLayer {
  /**
   * Check if a file path is within the allowed scope.
   * NEW in v0.14.0: Validates session-level paths against agent-level paths.
   *
   * @param targetPath - The path to validate
   * @param sessionId - Optional session ID for session-scoped validation
   * @throws SecurityError if path is outside allowed scope
   */
  validatePath(targetPath: string, sessionId?: string): void;
  /** Get the normalized allowed paths (agent-level). */
  getAllowedPaths(): string[];
}

/**
 * Create a security layer with path validation.
 * NEW in v0.14.0: Accepts optional session config accessor for session-scoped path validation.
 *
 * @param allowedPaths - Agent-level allowed paths
 * @param getSessionConfig - Optional accessor to retrieve session configuration by session ID
 */
export function createSecurityLayer(
  allowedPaths: string[],
  getSessionConfigFn?: (sessionId?: string) => SessionConfig | undefined,
): SecurityLayer {
  // Normalize all allowed paths at creation time
  const normalizedAllowed = allowedPaths.map((p) => safeRealpath(p));

  return {
    validatePath(targetPath: string, sessionId?: string): void {
      const normalizedTarget = safeRealpath(targetPath);

      // Get effective allowed paths (session override if present)
      let effectivePaths = normalizedAllowed;
      if (getSessionConfigFn && sessionId) {
        const sessionConfig = getSessionConfigFn(sessionId);
        if (sessionConfig?.allowedPaths && sessionConfig.allowedPaths.length > 0) {
          // Session paths must be subset of agent paths
          const sessionPaths = sessionConfig.allowedPaths.map(p => safeRealpath(p));
          const validSessionPaths = sessionPaths.filter(sessionPath =>
            isWithinRoots(sessionPath, normalizedAllowed)
          );

          if (validSessionPaths.length < sessionPaths.length) {
            const invalidPaths = sessionPaths.filter(p => !validSessionPaths.includes(p));
            logger.warn(`Session config contains invalid paths (not subset of agent paths)`, {
              sessionId,
              invalidPaths,
            });
          }

          effectivePaths = validSessionPaths.length > 0 ? validSessionPaths : normalizedAllowed;
        }
      }

      if (!isWithinRoots(normalizedTarget, effectivePaths)) {
        logger.warn(`Path blocked: ${normalizedTarget}`);
        throw new SecurityError(
          `Path "${targetPath}" is outside the allowed scope. Allowed: ${effectivePaths.join(", ")}`,
        );
      }
    },

    getAllowedPaths(): string[] {
      return [...normalizedAllowed];
    },
  };
}
