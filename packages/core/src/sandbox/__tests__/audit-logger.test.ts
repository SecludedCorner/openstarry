import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditLogger, sanitizeValue } from "../audit-logger.js";
import type { EventBus, AgentEvent } from "@openstarry/sdk";

function createMockBus(): EventBus & { events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  return {
    events,
    on: vi.fn(() => () => {}),
    once: vi.fn(() => () => {}),
    onAny: vi.fn(() => () => {}),
    emit: vi.fn((event: AgentEvent) => { events.push(event); }),
  };
}

describe("AuditLogger", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "audit-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("buffers entries until flush", async () => {
    const logger = new AuditLogger({
      pluginName: "test-plugin",
      logDir: tempDir,
      bufferSize: 100, // high buffer so no auto-flush
      flushIntervalMs: 60000, // long interval so no timer-flush
    });

    logger.logWorkerEvent("spawn", { memoryLimitMb: 512 });
    logger.logWorkerEvent("shutdown");

    // Before flush, no files should exist
    const filesBefore = await readdir(tempDir);
    expect(filesBefore).toHaveLength(0);

    await logger.flush();

    const filesAfter = await readdir(tempDir);
    expect(filesAfter).toHaveLength(1);
    expect(filesAfter[0]).toMatch(/^test-plugin-\d+\.jsonl$/);

    await logger.dispose();
  });

  it("auto-flushes on buffer size limit", async () => {
    const logger = new AuditLogger({
      pluginName: "test-plugin",
      logDir: tempDir,
      bufferSize: 2, // low buffer to trigger auto-flush
      flushIntervalMs: 60000,
    });

    logger.logWorkerEvent("spawn");
    logger.logWorkerEvent("crash");
    // The 2nd entry should trigger auto-flush

    // Wait a tick for async flush
    await new Promise((r) => setTimeout(r, 50));

    const files = await readdir(tempDir);
    expect(files.length).toBeGreaterThanOrEqual(1);

    await logger.dispose();
  });

  it("writes valid JSONL format", async () => {
    const logger = new AuditLogger({
      pluginName: "test-plugin",
      logDir: tempDir,
      bufferSize: 100,
      flushIntervalMs: 60000,
    });

    logger.logWorkerEvent("spawn", { memoryLimitMb: 512 });
    logger.logRpcStart("BUS_EMIT", "BUS_EMIT", { event: { type: "test" } });

    await logger.flush();

    const files = await readdir(tempDir);
    const content = await readFile(join(tempDir, files[0]), "utf-8");
    const lines = content.trim().split("\n");

    expect(lines).toHaveLength(2);

    // Each line should be valid JSON
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed).toHaveProperty("timestamp");
      expect(parsed).toHaveProperty("level");
      expect(parsed).toHaveProperty("pluginName", "test-plugin");
      expect(parsed).toHaveProperty("category");
      expect(parsed).toHaveProperty("operation");
    }

    await logger.dispose();
  });

  it("sanitizes secret fields in arguments", async () => {
    const logger = new AuditLogger({
      pluginName: "test-plugin",
      logDir: tempDir,
      bufferSize: 100,
      flushIntervalMs: 60000,
      sanitizeArgs: true,
    });

    logger.logRpcStart("PUSH_INPUT", "PUSH_INPUT", {
      apiKey: "sk-abc123",
      password: "secret123",
      data: "hello",
    });

    await logger.flush();

    const files = await readdir(tempDir);
    const content = await readFile(join(tempDir, files[0]), "utf-8");
    const entry = JSON.parse(content.trim());

    // "apiKey" matches SECRET_PATTERN (/key/i), so it's redacted too
    expect(entry.args.apiKey).toBe("[REDACTED]");
    expect(entry.args.password).toBe("[REDACTED]");
    expect(entry.args.data).toBe("hello");

    await logger.dispose();
  });

  it("truncates long strings in arguments", async () => {
    const logger = new AuditLogger({
      pluginName: "test-plugin",
      logDir: tempDir,
      bufferSize: 100,
      flushIntervalMs: 60000,
      sanitizeArgs: true,
    });

    const longString = "x".repeat(500);
    logger.logRpcStart("BUS_EMIT", "BUS_EMIT", { data: longString });

    await logger.flush();

    const files = await readdir(tempDir);
    const content = await readFile(join(tempDir, files[0]), "utf-8");
    const entry = JSON.parse(content.trim());

    expect(entry.args.data.length).toBeLessThan(300);
    expect(entry.args.data).toContain("... [truncated]");

    await logger.dispose();
  });

  it("tracks RPC operation duration with logRpcStart/logRpcEnd", async () => {
    const logger = new AuditLogger({
      pluginName: "test-plugin",
      logDir: tempDir,
      bufferSize: 100,
      flushIntervalMs: 60000,
    });

    const opId = logger.logRpcStart("BUS_EMIT", "BUS_EMIT");

    // Simulate some processing time
    await new Promise((r) => setTimeout(r, 10));

    logger.logRpcEnd(opId, "success");

    await logger.flush();

    const files = await readdir(tempDir);
    const content = await readFile(join(tempDir, files[0]), "utf-8");
    const lines = content.trim().split("\n");
    const endEntry = JSON.parse(lines[1]);

    expect(endEntry.result).toBe("success");
    expect(endEntry.durationMs).toBeGreaterThanOrEqual(5);

    await logger.dispose();
  });

  it("logs tool invocations with timing", async () => {
    const logger = new AuditLogger({
      pluginName: "test-plugin",
      logDir: tempDir,
      bufferSize: 100,
      flushIntervalMs: 60000,
    });

    logger.logToolInvocation("my-tool", { query: "test" }, "success", 42);

    await logger.flush();

    const files = await readdir(tempDir);
    const content = await readFile(join(tempDir, files[0]), "utf-8");
    const entry = JSON.parse(content.trim());

    expect(entry.category).toBe("tool");
    expect(entry.operation).toBe("invokeTool");
    expect(entry.method).toBe("my-tool");
    expect(entry.result).toBe("success");
    expect(entry.durationMs).toBe(42);

    await logger.dispose();
  });

  it("logs module blocked events", async () => {
    const logger = new AuditLogger({
      pluginName: "test-plugin",
      logDir: tempDir,
      bufferSize: 100,
      flushIntervalMs: 60000,
    });

    logger.logModuleBlocked("fs", "/path/to/plugin.js");

    await logger.flush();

    const files = await readdir(tempDir);
    const content = await readFile(join(tempDir, files[0]), "utf-8");
    const entry = JSON.parse(content.trim());

    expect(entry.category).toBe("lifecycle");
    expect(entry.operation).toBe("module_blocked");
    expect(entry.args.moduleName).toBe("fs");
    expect(entry.args.parentFile).toBe("/path/to/plugin.js");

    await logger.dispose();
  });

  it("dispose flushes remaining buffer", async () => {
    const logger = new AuditLogger({
      pluginName: "test-plugin",
      logDir: tempDir,
      bufferSize: 100,
      flushIntervalMs: 60000,
    });

    logger.logWorkerEvent("spawn");

    // Dispose should flush
    await logger.dispose();

    const files = await readdir(tempDir);
    expect(files).toHaveLength(1);
    const content = await readFile(join(tempDir, files[0]), "utf-8");
    expect(content.trim()).not.toBe("");
  });

  it("emits SANDBOX_AUDIT_LOG_ERROR on write failure", async () => {
    // Create a file that blocks directory creation (works cross-platform)
    const blockingFile = join(tempDir, "blocking-file");
    writeFileSync(blockingFile, "not-a-dir");

    const bus = createMockBus();
    const logger = new AuditLogger({
      pluginName: "test-plugin",
      logDir: join(blockingFile, "subdir"),
      bufferSize: 100, // high buffer so addEntry doesn't fire-and-forget flush
      flushIntervalMs: 60000,
      bus,
    });

    logger.logWorkerEvent("spawn");

    // dispose() calls await flush() which hits the nonexistent dir and emits error
    await logger.dispose();

    const errorEvents = bus.events.filter((e) => e.type === "sandbox:audit_log_error");
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
  });
});

describe("sanitizeValue", () => {
  it("redacts fields matching secret patterns", () => {
    const result = sanitizeValue({
      password: "secret123",
      token: "abc",
      authHeader: "Bearer xyz",
      data: "visible",
    }) as Record<string, unknown>;

    expect(result.password).toBe("[REDACTED]");
    expect(result.token).toBe("[REDACTED]");
    expect(result.authHeader).toBe("[REDACTED]");
    expect(result.data).toBe("visible");
  });

  it("truncates long strings", () => {
    const result = sanitizeValue("x".repeat(500));
    expect(typeof result).toBe("string");
    expect((result as string).length).toBeLessThan(300);
    expect(result).toContain("... [truncated]");
  });

  it("keeps short strings unchanged", () => {
    expect(sanitizeValue("hello")).toBe("hello");
  });

  it("keeps numbers and booleans unchanged", () => {
    expect(sanitizeValue(42)).toBe(42);
    expect(sanitizeValue(true)).toBe(true);
    expect(sanitizeValue(null)).toBe(null);
  });

  it("sanitizes nested objects with depth limit", () => {
    const result = sanitizeValue({
      level1: {
        level2: {
          level3: {
            level4: "deep",
          },
        },
      },
    }) as any;

    expect(result.level1.level2.level3.level4).toBe("[depth limit]");
  });

  it("sanitizes arrays", () => {
    const result = sanitizeValue(["hello", "x".repeat(500), 42]) as unknown[];
    expect(result[0]).toBe("hello");
    expect((result[1] as string)).toContain("... [truncated]");
    expect(result[2]).toBe(42);
  });
});
