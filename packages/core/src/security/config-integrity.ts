/**
 * ConfigIntegrityChecker — SHA-256 in-memory hash for config tamper detection.
 *
 * Non-blocking, informational only (Tenet #7: Core does not enforce policy).
 * In-memory only — detects runtime tampering within a session, not cross-restart.
 *
 * @skandha samjna (想蘊)
 * @see Plan36a §4.2
 */

import { createHash } from "node:crypto";

export interface ConfigIntegrityChecker {
  /** Record the baseline hash for a config file. */
  recordBaseline(filePath: string, content: string): void;
  /** Verify content against recorded baseline. */
  verify(filePath: string, content: string): { tampered: boolean; reason?: string };
}

export function createConfigIntegrityChecker(): ConfigIntegrityChecker {
  const baselines = new Map<string, string>();

  function hash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  return {
    recordBaseline(filePath: string, content: string): void {
      baselines.set(filePath, hash(content));
    },

    verify(filePath: string, content: string): { tampered: boolean; reason?: string } {
      const baseline = baselines.get(filePath);
      if (!baseline) return { tampered: false };
      const current = hash(content);
      if (current !== baseline) {
        return { tampered: true, reason: `SHA-256 mismatch for ${filePath}` };
      }
      return { tampered: false };
    },
  };
}
