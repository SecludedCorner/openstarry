/**
 * Project root detection for .openstarry/ directory.
 * Plan34: Project-Level Config Support.
 *
 * Searches upward from CWD for the nearest .openstarry/ directory.
 */

import { existsSync, statSync } from "node:fs";
import { join, dirname, parse } from "node:path";
import type { IProjectContext } from "@openstarry/sdk";

/**
 * Find the nearest .openstarry/ directory by searching upward from CWD.
 *
 * Termination conditions (in order):
 * 1. Found .openstarry/ that is a real directory (not a symlink target
 *    outside the tree — validated by isPathSafe in permission-validator).
 * 2. Reached filesystem root: path.parse(dir).root === dir
 *    (handles POSIX "/", Windows "C:\", and Windows UNC "\\server\share\").
 * 3. No .openstarry/ found anywhere in the upward path.
 *
 * @param startDir - Starting directory (defaults to process.cwd())
 * @returns IProjectContext if found, null if no .openstarry/ exists in the tree.
 */
export function findProjectRoot(startDir?: string): IProjectContext | null {
  let dir = startDir ?? process.cwd();

  while (true) {
    const candidate = join(dir, ".openstarry");
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isDirectory()) {
          return {
            projectRoot: dir,
            dotOpenstarryPath: candidate,
          };
        }
      } catch {
        // stat failed — treat as not found, continue upward
      }
    }

    // Check for filesystem root (POSIX "/", Windows "C:\", Windows UNC "\\server\share\")
    if (parse(dir).root === dir) {
      return null;
    }

    const parent = dirname(dir);
    // Safety guard: if dirname didn't advance (shouldn't happen after root check)
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}
