/**
 * Audit Trail Chain Verifier — verifies SHA-256 hash chain integrity.
 *
 * Per-entry hash chain with prevHash linking.
 * First entry: prevHash = '0'. Rotation resets chain.
 *
 * @skandha vijnana (識蘊)
 * @see Plan36b §4.2
 */

import { createHash } from "node:crypto";

export interface ChainVerificationResult {
  readonly valid: boolean;
  readonly entryCount: number;
  readonly firstBrokenEntry?: number;
  readonly error?: string;
}

/**
 * Canonical JSON stringify with sorted keys for deterministic hashing.
 */
export function canonicalStringify(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/**
 * Compute SHA-256 hash for an audit trail entry (excluding entryHash field).
 */
export function computeEntryHash(entry: Record<string, unknown>): string {
  const canonical = canonicalStringify(entry);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Verify the integrity of an audit trail JSONL file's hash chain.
 */
export function verifyAuditChain(jsonlContent: string): ChainVerificationResult {
  const lines = jsonlContent.trim().split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
    return { valid: true, entryCount: 0 };
  }

  let expectedPrevHash = '0';
  let entryIndex = 0;

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return {
        valid: false,
        entryCount: entryIndex,
        firstBrokenEntry: entryIndex,
        error: `Entry ${entryIndex}: invalid JSON`,
      };
    }

    // Skip entries without hash fields (backward compatibility)
    if (!('prevHash' in entry) || !('entryHash' in entry)) {
      entryIndex++;
      continue;
    }

    // Verify prevHash chain
    if (entry.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        entryCount: entryIndex,
        firstBrokenEntry: entryIndex,
        error: `Chain broken at entry ${entryIndex}: expected prevHash ${String(expectedPrevHash).slice(0, 8)}..., got ${String(entry.prevHash).slice(0, 8)}...`,
      };
    }

    // Verify entryHash
    const storedHash = entry.entryHash as string;
    const { entryHash: _, ...rest } = entry;
    const computed = computeEntryHash(rest);
    if (computed !== storedHash) {
      return {
        valid: false,
        entryCount: entryIndex,
        firstBrokenEntry: entryIndex,
        error: `Entry ${entryIndex} hash mismatch: computed ${computed.slice(0, 8)}..., stored ${storedHash.slice(0, 8)}...`,
      };
    }

    expectedPrevHash = storedHash;
    entryIndex++;
  }

  return { valid: true, entryCount: entryIndex };
}
