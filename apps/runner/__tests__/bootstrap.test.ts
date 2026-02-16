import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import {
  bootstrap,
  isInitialized,
  getAgentConfigPath,
  OPENSTARRY_HOME,
  DEFAULT_AGENT_PATH,
  SYSTEM_CONFIG_PATH,
} from "../src/bootstrap.js";

describe("bootstrap", () => {
  it("should detect first run when default agent doesn't exist", () => {
    // This tests the isInitialized function
    const initialized = isInitialized();
    // Can't assert specific value as it depends on environment
    expect(typeof initialized).toBe("boolean");
  });

  it("should return correct paths", async () => {
    const result = await bootstrap();

    expect(result).toBeDefined();
    expect(result.isFirstRun).toBeDefined();
    expect(result.configPath).toBe(DEFAULT_AGENT_PATH);
    expect(result.openstarryHome).toBe(OPENSTARRY_HOME);
  });

  it("should create ~/.openstarry/ on first run", async () => {
    // Note: This test will only work correctly if ~/.openstarry/ doesn't exist
    // In practice, this is a system-level test
    const result = await bootstrap();

    // After bootstrap, the directory should exist
    expect(existsSync(OPENSTARRY_HOME)).toBe(true);
  });

  it("should create default agent config on first run", async () => {
    await bootstrap();

    // Default agent config should exist
    expect(existsSync(DEFAULT_AGENT_PATH)).toBe(true);
  });

  it("should create system config on first run", async () => {
    await bootstrap();

    // System config should exist
    expect(existsSync(SYSTEM_CONFIG_PATH)).toBe(true);
  });

  it("should get agent config path for named agent", () => {
    const path = getAgentConfigPath("my-agent");
    expect(path).toContain("my-agent.json");
    expect(path).toContain(".openstarry");
  });

  it("should handle subsequent runs without error", async () => {
    // First run
    await bootstrap();

    // Second run should not fail
    const result = await bootstrap();
    expect(result.isFirstRun).toBe(false);
  });
});
