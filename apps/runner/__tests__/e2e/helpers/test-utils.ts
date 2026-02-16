/**
 * Shared test utilities for E2E tests.
 */

import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Create a temporary directory for test artifacts.
 * Returns the path to the directory.
 */
export function createTempDir(prefix = "openstarry-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Remove a directory and all its contents.
 */
export function removeTempDir(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

/**
 * Wait for a condition to be true.
 */
export async function waitFor(
  condition: () => boolean,
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timeout waiting for condition");
    }
    await sleep(intervalMs);
  }
}

/**
 * Sleep for a specified duration in milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a unique test ID.
 */
export function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
