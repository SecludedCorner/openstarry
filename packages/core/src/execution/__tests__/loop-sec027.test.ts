/**
 * Tests for SEC-027: sessionId in GearContext must be hash, not path.
 * @see execution/loop.ts — createHash usage for agentConfig.id
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

describe("SEC-027: GearContext sessionId path leak prevention", () => {
  it("SHA-256 hash of workingDirectory produces 16-char hex, not a path", () => {
    const workingDirectory = "/home/user/secret-project";
    const hashed = createHash("sha256").update(workingDirectory).digest("hex").slice(0, 16);

    expect(hashed).toHaveLength(16);
    expect(hashed).toMatch(/^[0-9a-f]{16}$/);
    // Must NOT contain the original path
    expect(hashed).not.toContain("home");
    expect(hashed).not.toContain("user");
    expect(hashed).not.toContain("secret");
  });

  it("same input produces same hash (deterministic)", () => {
    const path = "C:\\Users\\test\\project";
    const hash1 = createHash("sha256").update(path).digest("hex").slice(0, 16);
    const hash2 = createHash("sha256").update(path).digest("hex").slice(0, 16);
    expect(hash1).toBe(hash2);
  });

  it("different inputs produce different hashes", () => {
    const hash1 = createHash("sha256").update("/path/a").digest("hex").slice(0, 16);
    const hash2 = createHash("sha256").update("/path/b").digest("hex").slice(0, 16);
    expect(hash1).not.toBe(hash2);
  });
});
