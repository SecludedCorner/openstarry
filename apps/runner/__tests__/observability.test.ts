/**
 * observability wire-in tests (FIX-2026-06-11 repair sprint).
 *
 * Verifies the Plan48 wire-in end-to-end at the module level: opt-in
 * activation, capability_denied journaling through the real AuditBus +
 * AuditSink + BufferedWriter chain, structured-log lifecycle records, and
 * the ordered shutdown flush cascade (structured-log 200 → audit-sink 300).
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createObservability } from "../src/observability.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "obs-test-"));
  tempDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

describe("createObservability — opt-in activation", () => {
  it("is fully disabled when no env/overrides are present", () => {
    const prevLog = process.env["OPENSTARRY_LOG_PATH"];
    const prevAudit = process.env["OPENSTARRY_AUDIT"];
    const prevSinkPath = process.env["AUDIT_SINK_PATH"];
    delete process.env["OPENSTARRY_LOG_PATH"];
    delete process.env["OPENSTARRY_AUDIT"];
    delete process.env["AUDIT_SINK_PATH"];
    try {
      const obs = createObservability();
      expect(obs.log).toBeNull();
      expect(obs.auditBus).toBeNull();
      // No-op publish must not throw when disabled.
      obs.publishCapabilityDenied({
        plugin: "p", tool: "t", allowedTools: [], timestamp: new Date().toISOString(),
      });
    } finally {
      if (prevLog !== undefined) process.env["OPENSTARRY_LOG_PATH"] = prevLog;
      if (prevAudit !== undefined) process.env["OPENSTARRY_AUDIT"] = prevAudit;
      if (prevSinkPath !== undefined) process.env["AUDIT_SINK_PATH"] = prevSinkPath;
    }
  });
});

describe("createObservability — audit-sink journaling", () => {
  it("journals capability_denied through bus → sink → JSONL file on flush", async () => {
    const dir = makeTempDir();
    const auditPath = join(dir, "audit-trail.jsonl");
    const obs = createObservability({ auditPath });

    expect(obs.auditBus).not.toBeNull();
    obs.publishCapabilityDenied({
      plugin: "test-plugin",
      tool: "fs.delete",
      allowedTools: ["fs.read"],
      timestamp: new Date().toISOString(),
    });

    await obs.flush();

    expect(existsSync(auditPath)).toBe(true);
    const lines = readFileSync(auditPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
    const record = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(record.type).toBe("capability_denied");
    expect(record.plugin).toBe("test-plugin");
    expect(record.tool).toBe("fs.delete");
    expect(record.audit_key).toBeDefined();
  });

  it("dedupes identical events within the dedup window", async () => {
    const dir = makeTempDir();
    const auditPath = join(dir, "audit-trail.jsonl");
    const obs = createObservability({ auditPath });

    const event = {
      plugin: "test-plugin",
      tool: "fs.delete",
      allowedTools: ["fs.read"] as readonly string[],
      timestamp: "2026-06-11T00:00:00.000Z",
    };
    obs.publishCapabilityDenied(event);
    obs.publishCapabilityDenied(event);

    await obs.flush();

    const lines = readFileSync(auditPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
  });
});

describe("createObservability — structured-log lifecycle", () => {
  it("writes lifecycle records to OPENSTARRY_LOG_PATH-style sink and flushes in order", async () => {
    const dir = makeTempDir();
    const logPath = join(dir, "runner.jsonl");
    const auditPath = join(dir, "audit-trail.jsonl");
    const obs = createObservability({ logPath, auditPath });

    expect(obs.log).not.toBeNull();
    obs.log!.info("runner:started", { configPath: "/tmp/agent.json" });
    obs.log!.info("plugin:loaded", { name: "x", version: "1" });
    obs.publishCapabilityDenied({
      plugin: "p", tool: "t", allowedTools: [], timestamp: new Date().toISOString(),
    });
    obs.log!.info("runner:shutdown", { signal: "SIGINT" });

    await obs.flush("SIGINT");

    const logLines = readFileSync(logPath, "utf-8").trim().split("\n").map((l) => JSON.parse(l) as { event: string });
    expect(logLines.map((r) => r.event)).toEqual([
      "runner:started",
      "plugin:loaded",
      "runner:shutdown",
    ]);
    expect(existsSync(auditPath)).toBe(true);
  });

  it("registers both flush hooks at the documented Plan48 orders (200 < 300)", () => {
    const dir = makeTempDir();
    const obs = createObservability({
      logPath: join(dir, "runner.jsonl"),
      auditPath: join(dir, "audit.jsonl"),
    });
    const hooks = obs.shutdown.list();
    const orders = new Map(hooks.map((h) => [h.id, h.order]));
    expect(orders.get("structured-log.flush")).toBe(200);
    expect(orders.get("audit-sink.flush")).toBe(300);
  });
});
