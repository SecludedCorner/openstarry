/**
 * File Lock — Dual-layer locking for SecureStore concurrency safety.
 *
 * Layer 1: In-process async mutex (Map<string, Promise>) — serializes
 *          concurrent calls within the same Node.js process.
 * Layer 2: Cross-process lock file (O_EXCL) — prevents races between
 *          separate runner processes sharing the same storage directory.
 */
import { open, unlink, readFile } from "node:fs/promises";
import { constants } from "node:fs";

// ─── In-Process Mutex ───

const locks = new Map<string, Promise<unknown>>();

/**
 * Serialize async operations on the same `key` within this process.
 * Different keys run concurrently.
 */
export async function withProcessLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // Wait for any pending operation on this key
  while (locks.has(key)) {
    try {
      await locks.get(key);
    } catch {
      // Previous holder threw — we still proceed
    }
  }

  const promise = fn();
  locks.set(key, promise);

  try {
    return await promise;
  } finally {
    // Only delete if we are still the current holder
    if (locks.get(key) === promise) {
      locks.delete(key);
    }
  }
}

// ─── Cross-Process File Lock ───

export interface FileLockOptions {
  /** Max time (ms) to wait for the lock before throwing. Default: 5000 */
  timeoutMs?: number;
  /** Age (ms) after which a lock file is considered stale. Default: 30000 */
  staleMs?: number;
  /** Initial retry interval (ms). Backs off up to 4x. Default: 50 */
  retryMs?: number;
}

interface LockPayload {
  pid: number;
  ts: number;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function tryCleanStaleLock(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const content = await readFile(lockPath, "utf-8");
    const payload: LockPayload = JSON.parse(content);
    const age = Date.now() - payload.ts;

    if (age > staleMs || !isPidAlive(payload.pid)) {
      try {
        await unlink(lockPath);
        return true;
      } catch {
        return false;
      }
    }
  } catch {
    // Can't read/parse — try removing anyway
    try {
      await unlink(lockPath);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Acquire a cross-process file lock using O_EXCL (atomic create-or-fail).
 * Returns a `release()` function that removes the lock file.
 *
 * @throws Error if the lock cannot be acquired within `timeoutMs`.
 */
export async function acquireFileLock(
  lockPath: string,
  options?: FileLockOptions,
): Promise<() => Promise<void>> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const staleMs = options?.staleMs ?? 30000;
  const baseRetryMs = options?.retryMs ?? 50;

  const deadline = Date.now() + timeoutMs;
  let retryMs = baseRetryMs;

  const payload: LockPayload = { pid: process.pid, ts: Date.now() };
  const data = JSON.stringify(payload);

  while (true) {
    try {
      const fh = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
      await fh.writeFile(data, "utf-8");
      await fh.close();

      // Return release function
      return async () => {
        try {
          await unlink(lockPath);
        } catch {
          // Lock file already removed — safe to ignore
        }
      };
    } catch (err: unknown) {
      // EEXIST means another holder has the lock
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "EEXIST") {
        // Try to clean stale lock
        await tryCleanStaleLock(lockPath, staleMs);

        if (Date.now() >= deadline) {
          throw new Error(`Failed to acquire file lock: ${lockPath} (timeout ${timeoutMs}ms)`);
        }

        // Wait with backoff
        await new Promise<void>((r) => setTimeout(r, retryMs));
        retryMs = Math.min(retryMs * 2, baseRetryMs * 4);
        continue;
      }
      throw err;
    }
  }
}
