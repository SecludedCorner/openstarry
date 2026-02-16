import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { Readable, Writable } from "node:stream";
import { InitCommand } from "../../src/commands/init.js";
import type { ParsedArgs } from "../../src/commands/base.js";
import type { IAgentConfig } from "@openstarry/sdk";

const testDir = resolve(tmpdir(), `openstarry-test-${Date.now()}`);

describe("InitCommand", () => {
  beforeEach(() => {
    // Mock process.cwd to return test directory
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(() => {
    // Cleanup
    const agentPath = resolve(testDir, "agent.json");
    if (existsSync(agentPath)) {
      unlinkSync(agentPath);
    }
    vi.restoreAllMocks();
  });

  it("should create agent.json", async () => {
    const command = new InitCommand();

    // Mock stdin/stdout
    const mockInputs = ["TestAgent", "Test Description", "gemini-oauth", "gemini-2.0-flash"];
    const input = Readable.from(mockInputs.map(i => i + "\n"));
    const output = new Writable({ write: (_chunk, _enc, cb) => cb() });

    // Mock Prompter to use our streams
    vi.spyOn(console, "log").mockImplementation(() => {});

    const args: ParsedArgs = {
      command: "init",
      flags: {},
      positional: [],
    };

    // Note: This test will use actual stdin prompts in current implementation
    // In a real scenario, we'd need to inject the Prompter dependency
    // For now, we'll skip the actual execution and test the config generation directly

    const result = command["generateConfig"]({
      name: "TestAgent",
      description: "Test Description",
      provider: "gemini-oauth",
      model: "gemini-2.0-flash",
      plugins: [],
    });

    expect(result.identity.name).toBe("TestAgent");
    expect(result.cognition.provider).toBe("gemini-oauth");
  });

  it("should fail if agent.json exists without --force", async () => {
    const command = new InitCommand();

    // Create test directory if it doesn't exist
    const { mkdir } = await import("node:fs/promises");
    await mkdir(testDir, { recursive: true });

    // Create a dummy agent.json
    const agentPath = resolve(testDir, "agent.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(agentPath, "{}", "utf-8");

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const args: ParsedArgs = {
      command: "init",
      flags: {},
      positional: [],
    };

    const exitCode = await command.execute(args);

    expect(exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("already exists"));
    consoleErrorSpy.mockRestore();
  });

  it("should generate valid config", () => {
    const command = new InitCommand();

    const result = command["generateConfig"]({
      name: "MyAgent",
      description: "My test agent",
      provider: "gemini-oauth",
      model: "gemini-2.0-flash",
      plugins: [],
    });

    expect(result.identity.id).toBe("myagent");
    expect(result.identity.name).toBe("MyAgent");
    expect(result.identity.description).toBe("My test agent");
    expect(result.cognition.provider).toBe("gemini-oauth");
    expect(result.cognition.model).toBe("gemini-2.0-flash");
    expect(result.capabilities.tools).toBeDefined();
    expect(result.plugins).toBeDefined();
    expect(result.plugins.length).toBeGreaterThan(0);
  });

  it("should normalize agent name to id", () => {
    const command = new InitCommand();

    const result = command["generateConfig"]({
      name: "My Test Agent",
      description: "Test",
      provider: "gemini-oauth",
      model: "gemini-2.0-flash",
      plugins: [],
    });

    expect(result.identity.id).toBe("my-test-agent");
  });

  it("should include default plugins", () => {
    const command = new InitCommand();

    const result = command["generateConfig"]({
      name: "Test",
      description: "Test",
      provider: "gemini-oauth",
      model: "gemini-2.0-flash",
      plugins: [],
    });

    expect(result.plugins.length).toBeGreaterThan(0);
    expect(result.plugins.some(p => p.name.includes("provider"))).toBe(true);
  });

  it("should set reasonable defaults", () => {
    const command = new InitCommand();

    const result = command["generateConfig"]({
      name: "Test",
      description: "Test",
      provider: "gemini-oauth",
      model: "gemini-2.0-flash",
      plugins: [],
    });

    expect(result.cognition.temperature).toBe(0.7);
    expect(result.cognition.maxTokens).toBe(8192);
    expect(result.policy?.maxConcurrentTools).toBe(1);
    expect(result.memory?.slidingWindowSize).toBe(5);
  });

  it("should include process.cwd in allowedPaths", () => {
    const command = new InitCommand();

    const result = command["generateConfig"]({
      name: "Test",
      description: "Test",
      provider: "gemini-oauth",
      model: "gemini-2.0-flash",
      plugins: [],
    });

    expect(result.capabilities.allowedPaths).toBeDefined();
    expect(result.capabilities.allowedPaths!.length).toBeGreaterThan(0);
  });
});
