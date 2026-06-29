/**
 * realpath-jail — symlink-aware filesystem jail primitive.
 *
 * Single source of truth for the path-confinement check shared by:
 *   - the core SecurityLayer (packages/core/src/security/guardrails.ts), and
 *   - filesystem-touching plugins (e.g. @openstarry-plugin/standard-function-fs).
 *
 * The jail resolves symlinks via realpathSync on BOTH the target and the allowed
 * roots before comparing, so a symlink placed inside an allowed root that points
 * outside it is rejected — a purely lexical (resolve+normalize) check cannot catch
 * that. Living in @openstarry/shared (a leaf utility depending only on
 * @openstarry/sdk + node:) keeps microkernel purity: core imports it like it already
 * imports createLogger, and plugins import it without reaching into @openstarry/core.
 */

import { resolve, normalize, dirname, basename } from "node:path";
import { realpathSync } from "node:fs";
import { SecurityError } from "@openstarry/sdk";

/**
 * Resolve a path to its real (symlink-followed) location.
 *
 * If the path does not exist yet (e.g. a not-yet-created file being written),
 * realpathSync throws; we then realpath the PARENT directory and re-join the tail,
 * so a symlinked ANCESTOR is still caught while a legitimate new-file write inside a
 * real directory is allowed. Final fallback is the lexically resolved path.
 */
export function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    // File doesn't exist yet — resolve parent to catch symlinks in ancestors
    const resolved = resolve(normalize(p));
    const parent = dirname(resolved);
    const tail = basename(resolved);
    try {
      return resolve(realpathSync(parent), tail);
    } catch {
      return resolved;
    }
  }
}

/**
 * Is `normalizedTarget` within any of `realRoots`?
 * Both arguments are expected to be already realpath-resolved (idempotent if not).
 * Compares with both "/" and "\\" separators so Windows roots match correctly.
 */
export function isWithinRoots(normalizedTarget: string, realRoots: string[]): boolean {
  return realRoots.some(
    (root) =>
      normalizedTarget === root ||
      normalizedTarget.startsWith(root + "/") ||
      normalizedTarget.startsWith(root + "\\"),
  );
}

export interface RealpathJailOptions {
  /** If provided, `targetPath` is resolved relative to this directory (plugin semantics). */
  workingDirectory?: string;
  /** Allowed roots. Realpathed internally; passing already-real paths is fine (idempotent). */
  allowedPaths: string[];
}

/**
 * Confine `targetPath` to `allowedPaths`, following symlinks.
 *
 * @returns the realpath-resolved absolute path, for the caller to use in the syscall.
 * @throws SecurityError if the (symlink-resolved) target escapes every allowed root.
 */
export function realpathJail(targetPath: string, opts: RealpathJailOptions): string {
  const base = opts.workingDirectory ? resolve(opts.workingDirectory, targetPath) : targetPath;
  const realTarget = safeRealpath(base);
  const realRoots = opts.allowedPaths.map(safeRealpath);

  if (!isWithinRoots(realTarget, realRoots)) {
    throw new SecurityError(
      `Path "${targetPath}" is outside the allowed scope. Allowed: ${realRoots.join(", ")}`,
    );
  }

  return realTarget;
}
