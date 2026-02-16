/**
 * Plugin Lock File — Track installed plugins in ~/.openstarry/plugins/lock.json.
 */

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { PLUGINS_DIR } from "../bootstrap.js";
import { join } from "node:path";

export interface LockEntry {
  name: string;
  version: string;
  installedAt: string;
}

export interface PluginLock {
  version: string;
  plugins: Record<string, LockEntry>;
}

/** Default lock file path. Can be overridden for testing. */
export const LOCK_FILE_PATH = join(PLUGINS_DIR, "lock.json");

function emptyLock(): PluginLock {
  return { version: "1", plugins: {} };
}

/**
 * Read the lock file. Returns empty lock if the file doesn't exist or is corrupt.
 */
export async function readLockFile(lockPath: string = LOCK_FILE_PATH): Promise<PluginLock> {
  if (!existsSync(lockPath)) {
    return emptyLock();
  }
  try {
    const raw = await readFile(lockPath, "utf-8");
    const parsed = JSON.parse(raw) as PluginLock;
    if (!parsed.plugins || typeof parsed.plugins !== "object") {
      return emptyLock();
    }
    return parsed;
  } catch {
    return emptyLock();
  }
}

/**
 * Write the lock file atomically (write to tmp, then rename).
 */
export async function writeLockFile(
  lock: PluginLock,
  lockPath: string = LOCK_FILE_PATH,
): Promise<void> {
  await mkdir(dirname(lockPath), { recursive: true });
  const content = JSON.stringify(lock, null, 2) + "\n";
  await writeFile(lockPath, content, "utf-8");
}

/**
 * Add or update an entry in the lock file.
 */
export async function addToLock(
  name: string,
  version: string,
  lockPath: string = LOCK_FILE_PATH,
): Promise<void> {
  const lock = await readLockFile(lockPath);
  lock.plugins[name] = {
    name,
    version,
    installedAt: new Date().toISOString(),
  };
  await writeLockFile(lock, lockPath);
}

/**
 * Remove an entry from the lock file.
 */
export async function removeFromLock(
  name: string,
  lockPath: string = LOCK_FILE_PATH,
): Promise<void> {
  const lock = await readLockFile(lockPath);
  delete lock.plugins[name];
  await writeLockFile(lock, lockPath);
}

/**
 * Check if a plugin is recorded in the lock file.
 */
export async function isInstalled(
  name: string,
  lockPath: string = LOCK_FILE_PATH,
): Promise<boolean> {
  const lock = await readLockFile(lockPath);
  return name in lock.plugins;
}
