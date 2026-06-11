/**
 * Tests for audit chain verifier.
 * @see Plan36b §4.2, §7.2
 */
import { describe, it, expect } from "vitest";
import { verifyAuditChain, computeEntryHash, canonicalStringify } from "../audit-chain-verifier.js";

describe("canonicalStringify", () => {
  it("SEC-T10: produces deterministic output regardless of key order", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });
});

describe("computeEntryHash", () => {
  it("SEC-T9: produces consistent SHA-256 hash", () => {
    const entry = { timestamp: 1000, agentId: 'test', prevHash: '0' };
    const hash1 = computeEntryHash(entry);
    const hash2 = computeEntryHash(entry);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifyAuditChain", () => {
  function buildChain(count: number): string {
    const lines: string[] = [];
    let prevHash = '0';

    for (let i = 0; i < count; i++) {
      const entry: Record<string, unknown> = {
        timestamp: 1000 + i,
        agentId: 'test',
        version: 1,
        inputConfidence: 0.8,
        rawDelta: -0.01,
        clampedDelta: -0.01,
        wasClamped: false,
        reasoning: `entry ${i}`,
        outputConfidence: 0.79,
        result: 'adjusted',
        auditDurationMs: 5,
        prevHash,
      };
      const entryHash = computeEntryHash(entry);
      const full = { ...entry, entryHash };
      lines.push(JSON.stringify(full));
      prevHash = entryHash;
    }

    return lines.join('\n');
  }

  it("SEC-T8: empty file is valid", () => {
    const result = verifyAuditChain('');
    expect(result.valid).toBe(true);
    expect(result.entryCount).toBe(0);
  });

  it("SEC-T5: valid chain of 10 entries", () => {
    const content = buildChain(10);
    const result = verifyAuditChain(content);
    expect(result.valid).toBe(true);
    expect(result.entryCount).toBe(10);
  });

  it("SEC-T6: detects tampered entry", () => {
    const content = buildChain(10);
    const lines = content.split('\n');

    // Tamper entry 5
    const entry5 = JSON.parse(lines[5]);
    entry5.reasoning = 'TAMPERED';
    lines[5] = JSON.stringify(entry5);

    const result = verifyAuditChain(lines.join('\n'));
    expect(result.valid).toBe(false);
    expect(result.firstBrokenEntry).toBe(5);
  });

  it("SEC-T7: rotation resets chain (new file starts with prevHash='0')", () => {
    // Simulate a rotated file — first entry has prevHash='0'
    const content = buildChain(3);
    const result = verifyAuditChain(content);
    expect(result.valid).toBe(true);

    // First entry always has prevHash='0'
    const firstEntry = JSON.parse(content.split('\n')[0]);
    expect(firstEntry.prevHash).toBe('0');
  });

  it("handles entries without hash fields (backward compat)", () => {
    const legacyEntry = JSON.stringify({ timestamp: 1000, agentId: 'test', version: 1 });
    const result = verifyAuditChain(legacyEntry);
    expect(result.valid).toBe(true);
    expect(result.entryCount).toBe(1);
  });
});
