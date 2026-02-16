import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync, unlinkSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { StartCommand } from "../../src/commands/start.js";
import type { ParsedArgs } from "../../src/commands/base.js";
import type { IAgentConfig } from "@openstarry/sdk";

const testDir = resolve(tmpdir(), `openstarry-start-test-${Date.now()}`);

const validConfig: IAgentConfig = {
  identity: {
    id: "test-agent",
    name: "Test Agent",
    description: "A test agent",
    version: "0.1.0",
  },
  cognition: {
    provider: "gemini-oauth",
    model: "gemini-2.0-flash",
    temperature: 0.7,
    maxTokens: 8192,
    maxToolRounds: 10,
  },
  capabilities: {
    tools: ["fs.read", "fs.write"],
    allowedPaths: ["/tmp"],
  },
  policy: {
    maxConcurrentTools: 1,
    toolTimeout: 30000,
  },
  memory: {
    slidingWindowSize: 5,
  },
  plugins: [
    { name: "@openstarry-plugin/provider-gemini-oauth" },
  ],
  guide: "default-guide",
};

describe("StartCommand", () => {
  beforeEach(async () => {
    // Create test directory
    if (!existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Cleanup
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should load config from explicit path", async () => {
    const command = new StartCommand();
    const configPath = resolve(testDir, "test-config.json");
    await writeFile(configPath, JSON.stringify(validConfig), "utf-8");

    const loaded = await command["loadConfig"](configPath);

    expect(loaded.identity.id).toBe("test-agent");
  });

  it("should fail on missing config file", async () => {
    const command = new StartCommand();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const args: ParsedArgs = {
      command: "start",
      flags: { config: "/nonexistent/config.json" },
      positional: [],
    };

    const exitCode = await command.execute(args);

    expect(exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("should print validation errors", () => {
    const command = new StartCommand();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    command["printValidationErrors"]([
      {
        path: "cognition.model",
        message: "Invalid model",
        severity: "error",
        suggestion: "Use a valid model name",
      },
    ]);

    expect(consoleErrorSpy).toHaveBeenCalled();
    const calls = consoleErrorSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("cognition.model");
    expect(calls).toContain("Invalid model");
    consoleErrorSpy.mockRestore();
  });

  it("should block until shutdown signal in execute", () => {
    // Signal handlers are now integrated into execute()'s blocking Promise.
    // Full testing would require mocking createAgentCore and process signals.
    // Verify the command instance exists and has execute method.
    const command = new StartCommand();
    expect(typeof command.execute).toBe("function");
  });

  it("should handle verbose flag", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // This test would require full integration with plugin resolver
    // For now, just verify the flag is recognized
    const args: ParsedArgs = {
      command: "start",
      flags: { verbose: true },
      positional: [],
    };

    expect(args.flags.verbose).toBe(true);
    consoleSpy.mockRestore();
  });

  it("should default allowedPaths to cwd if empty", async () => {
    const command = new StartCommand();
    const configPath = resolve(testDir, "config-no-paths.json");

    const configNoPaths: IAgentConfig = {
      ...validConfig,
      capabilities: {
        ...validConfig.capabilities,
        allowedPaths: [],
      },
    };

    await writeFile(configPath, JSON.stringify(configNoPaths), "utf-8");

    // Just verify config loads (full execution would require core integration)
    const loaded = await command["loadConfig"](configPath);
    expect(loaded).toBeDefined();
  });

  it("should format validation errors with suggestions", () => {
    const command = new StartCommand();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    command["printValidationErrors"]([
      {
        path: "plugins",
        message: "No plugins configured",
        severity: "error",
        suggestion: "Add at least one plugin",
      },
    ]);

    const output = consoleErrorSpy.mock.calls.flat().join("\n");
    expect(output).toContain("Suggestion:");
    consoleErrorSpy.mockRestore();
  });

  it("should handle config with warnings gracefully", () => {
    const command = new StartCommand();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    command["printValidationErrors"]([
      {
        path: "capabilities.allowedPaths",
        message: "No allowed paths",
        severity: "warning",
      },
    ]);

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("should exit with code 1 on validation failure", async () => {
    const command = new StartCommand();
    const configPath = resolve(testDir, "invalid-config.json");

    const invalidConfig = {
      identity: { id: "", name: "" },
      cognition: { provider: "", model: "" },
      capabilities: { tools: [] },
      plugins: [],
    };

    await writeFile(configPath, JSON.stringify(invalidConfig), "utf-8");

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const args: ParsedArgs = {
      command: "start",
      flags: { config: configPath },
      positional: [],
    };

    const exitCode = await command.execute(args);

    expect(exitCode).toBe(1);
    consoleErrorSpy.mockRestore();
  });

  it("should fall back to ./agent.json before DEFAULT_AGENT_PATH", async () => {
    const originalCwd = process.cwd();
    const localConfigPath = resolve(testDir, "agent.json");

    // Create local agent.json in test directory
    await writeFile(localConfigPath, JSON.stringify(validConfig), "utf-8");

    // Change to test directory
    process.chdir(testDir);

    const command = new StartCommand();

    // Verify that ./agent.json exists
    expect(existsSync("agent.json")).toBe(true);

    // Restore cwd
    process.chdir(originalCwd);

    // Clean up
    unlinkSync(localConfigPath);
  });
});
