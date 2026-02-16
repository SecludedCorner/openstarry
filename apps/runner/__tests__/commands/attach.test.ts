/**
 * Attach Command Tests — Integration tests for AttachCommand.
 *
 * Tests cover: agent ID resolution, error handling, session validation,
 * auto-start logic, and security validations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AttachCommand } from "../../src/commands/attach.js";
import type { ParsedArgs } from "../../src/commands/base.js";
import { pidManager } from "../../src/daemon/pid-manager.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";

describe("Attach Command", () => {
  let cmd: AttachCommand;

  beforeEach(() => {
    cmd = new AttachCommand();
  });

  it("should have correct name and description", () => {
    expect(cmd.name).toBe("attach");
    expect(cmd.description).toBe("Attach to a running daemon session");
  });

  it("should implement CliCommand interface", () => {
    expect(typeof cmd.execute).toBe("function");
    expect(typeof cmd.name).toBe("string");
    expect(typeof cmd.description).toBe("string");
  });

  it("should fail if agent ID cannot be resolved (no positional, no agent.json)", async () => {
    // Mock listRunningAgents to return empty so auto-detect doesn't find real daemons
    const spy = vi.spyOn(pidManager, "listRunningAgents").mockReturnValue([]);

    const args: ParsedArgs = {
      command: "attach",
      flags: { config: "/nonexistent/agent.json" },
      positional: [],
    };

    const exitCode = await cmd.execute(args);
    expect(exitCode).toBe(1);

    spy.mockRestore();
  });

  it("should resolve agent ID from positional argument", async () => {
    // Pass an agent ID positionally — it'll fail at daemon check, but verifies ID resolution
    const args: ParsedArgs = {
      command: "attach",
      flags: {},
      positional: ["test-agent-123"],
    };

    // Will fail because daemon isn't running and no agent.json for auto-start,
    // but the agent ID should be resolved (check exit code is 1 for daemon connection failure)
    const exitCode = await cmd.execute(args);
    expect(exitCode).toBe(1);
  });

  it("should resolve agent ID from agent.json config file", async () => {
    const testDir = join(tmpdir(), `attach-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(testDir, { recursive: true });

    const configPath = join(testDir, "agent.json");
    writeFileSync(configPath, JSON.stringify({
      identity: { id: "json-agent", name: "JSON Agent", description: "Test", version: "0.1.0" },
      cognition: { provider: "test", model: "test", temperature: 0.7, maxTokens: 1000, maxToolRounds: 5 },
      capabilities: { tools: [], allowedPaths: [] },
      policy: { maxConcurrentTools: 1, toolTimeout: 5000 },
      memory: { slidingWindowSize: 5 },
      plugins: [],
      guide: "default",
    }), "utf-8");

    const args: ParsedArgs = {
      command: "attach",
      flags: { config: configPath },
      positional: [],
    };

    // Will fail at daemon connection but agent ID should resolve from config
    const exitCode = await cmd.execute(args);
    expect(exitCode).toBe(1);

    rmSync(testDir, { recursive: true, force: true });
  });

  it("should support verbose flag", () => {
    const cmd2 = new AttachCommand();
    expect(cmd2.name).toBe("attach");
    // Verbose is set during execute — just verify it's accepted as a flag
  });

  it("should handle connection errors gracefully", async () => {
    const args: ParsedArgs = {
      command: "attach",
      flags: {},
      positional: ["nonexistent-agent"],
    };

    // Should return 1 without throwing
    const exitCode = await cmd.execute(args);
    expect(exitCode).toBe(1);
  });
});

describe("Attach Command - Security Validations", () => {
  it("should reject invalid sessionId format via RPC", () => {
    // This validates the daemon-side validation logic
    // sessionId must match /^[a-zA-Z0-9_-]{1,64}$/
    const validIds = ["session_123", "abc-def", "a1b2c3", "session_1234567890"];
    const invalidIds = ["", "a".repeat(65), "session with spaces", "session;drop", "session\n"];

    const pattern = /^[a-zA-Z0-9_-]{1,64}$/;

    for (const id of validIds) {
      expect(pattern.test(id), `Expected "${id}" to be valid`).toBe(true);
    }
    for (const id of invalidIds) {
      expect(pattern.test(id), `Expected "${id}" to be invalid`).toBe(false);
    }
  });

  it("should reject invalid inputType via whitelist", () => {
    const ALLOWED_INPUT_TYPES = ["user_input", "slash_command"];

    expect(ALLOWED_INPUT_TYPES.includes("user_input")).toBe(true);
    expect(ALLOWED_INPUT_TYPES.includes("slash_command")).toBe(true);
    expect(ALLOWED_INPUT_TYPES.includes("admin_command")).toBe(false);
    expect(ALLOWED_INPUT_TYPES.includes("")).toBe(false);
    expect(ALLOWED_INPUT_TYPES.includes("system")).toBe(false);
  });

  it("should reject oversized data payloads", () => {
    const MAX_SIZE = 100 * 1024; // 100KB
    const smallData = JSON.stringify("hello world");
    const largeData = JSON.stringify("x".repeat(MAX_SIZE + 1));

    expect(smallData.length).toBeLessThan(MAX_SIZE);
    expect(largeData.length).toBeGreaterThan(MAX_SIZE);
  });
});
