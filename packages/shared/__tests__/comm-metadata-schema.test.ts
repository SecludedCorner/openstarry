/**
 * CommMetadataSchema tests — Plan38 C13 (SEC-008).
 *
 * SEC-008: CommMessage.metadata must be validated in Zod schema (MECHANISM).
 * - Max entries: MAX_COMM_METADATA_ENTRIES (32)
 * - Max value size: MAX_COMM_METADATA_VALUE_SIZE (1024 bytes)
 */

import { describe, it, expect } from "vitest";
import { CommMetadataSchema } from "../src/utils/config-schema.js";
import { MAX_COMM_METADATA_ENTRIES, MAX_COMM_METADATA_VALUE_SIZE } from "@openstarry/sdk";

describe("CommMetadataSchema (Plan38 C13 — SEC-008)", () => {
  it("accepts undefined (optional field)", () => {
    const result = CommMetadataSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });

  it("accepts empty metadata object", () => {
    const result = CommMetadataSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts metadata with exactly MAX_COMM_METADATA_ENTRIES entries", () => {
    const metadata: Record<string, string> = {};
    for (let i = 0; i < MAX_COMM_METADATA_ENTRIES; i++) {
      metadata[`key${i}`] = 'value';
    }
    const result = CommMetadataSchema.safeParse(metadata);
    expect(result.success).toBe(true);
  });

  it("rejects metadata with more than MAX_COMM_METADATA_ENTRIES entries", () => {
    const metadata: Record<string, string> = {};
    for (let i = 0; i < MAX_COMM_METADATA_ENTRIES + 1; i++) {
      metadata[`key${i}`] = 'value';
    }
    const result = CommMetadataSchema.safeParse(metadata);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/must not exceed.*entries/);
  });

  it("accepts metadata value of exactly MAX_COMM_METADATA_VALUE_SIZE bytes", () => {
    const result = CommMetadataSchema.safeParse({
      key: 'x'.repeat(MAX_COMM_METADATA_VALUE_SIZE),
    });
    expect(result.success).toBe(true);
  });

  it("rejects metadata value exceeding MAX_COMM_METADATA_VALUE_SIZE bytes", () => {
    const result = CommMetadataSchema.safeParse({
      key: 'x'.repeat(MAX_COMM_METADATA_VALUE_SIZE + 1),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/exceeds max/);
  });

  it("rejects metadata with non-string values", () => {
    const result = CommMetadataSchema.safeParse({ key: 42 });
    expect(result.success).toBe(false);
  });

  it("uses SDK constants (not hardcoded values)", () => {
    expect(MAX_COMM_METADATA_ENTRIES).toBe(32);
    expect(MAX_COMM_METADATA_VALUE_SIZE).toBe(1024);
  });
});
