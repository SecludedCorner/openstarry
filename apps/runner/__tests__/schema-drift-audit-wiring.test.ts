/**
 * Spec follow-through 2026-06-15: prove the schema-drift audited-mode sink is wired.
 *
 * `setSchemaDriftAuditSink` had only test callers, so `SCHEMA_DRIFT_MODE=audited`
 * dropped events into the no-op default — `createObservability` now wires it to the
 * structured-log writer. These tests prove: (1) an audited parse failure reaches the
 * structured log, (2) no writer (OPENSTARRY_LOG_PATH unset) leaves a clean no-op,
 * (3) tolerant mode (default) emits nothing.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createObservability } from "../src/observability.js";
import {
  applySchemaDriftPolicy,
  setSchemaDriftAuditSink,
  __resetSchemaDriftModeForTests,
} from "../src/schema-drift-policy/index.js";

const SCHEMA = z.object({ a: z.string() });

function cleanup(): void {
  setSchemaDriftAuditSink(undefined); // restore process-global no-op
  __resetSchemaDriftModeForTests();
  delete process.env.SCHEMA_DRIFT_MODE;
}

afterEach(cleanup);

describe("schema-drift audited-mode sink wiring (createObservability)", () => {
  it("audited parse failure reaches the structured-log writer", () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-drift-"));
    const logPath = join(dir, "log.jsonl");
    try {
      process.env.SCHEMA_DRIFT_MODE = "audited";
      __resetSchemaDriftModeForTests();
      const obs = createObservability({ logPath });

      const r = applySchemaDriftPolicy(SCHEMA, { a: 123 }, "drift-test-ctx");
      expect(r.ok).toBe(false);

      obs.log!.flushSync();
      const content = readFileSync(logPath, "utf8");
      expect(content).toContain("schema_drift_audit");
      expect(content).toContain("drift-test-ctx");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no writer (no logPath) leaves a clean no-op — audited failure does not throw", () => {
    process.env.SCHEMA_DRIFT_MODE = "audited";
    __resetSchemaDriftModeForTests();
    createObservability({}); // no logPath, no OPENSTARRY_LOG_PATH → writer null → no-op sink
    expect(() => applySchemaDriftPolicy(SCHEMA, { a: 123 }, "no-writer-ctx")).not.toThrow();
  });

  it("tolerant mode (default) emits nothing to the log", () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-drift-"));
    const logPath = join(dir, "log.jsonl");
    try {
      __resetSchemaDriftModeForTests(); // no SCHEMA_DRIFT_MODE → tolerant
      const obs = createObservability({ logPath });
      const r = applySchemaDriftPolicy(SCHEMA, { a: 123 }, "tolerant-ctx");
      expect(r.ok).toBe(false);
      obs.log!.flushSync();
      // Tolerant mode emits nothing, so the writer may never create the file.
      let content = "";
      try { content = readFileSync(logPath, "utf8"); } catch { content = ""; }
      expect(content).not.toContain("schema_drift_audit");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
