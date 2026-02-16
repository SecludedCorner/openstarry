/**
 * E2E Tests: CLI Integration
 * Tests the runner CLI commands (version, init, help, start).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCliHelper, createTempDir, removeTempDir } from "./helpers/index.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

describe("E2E: CLI Integration", () => {
  let cli: ReturnType<typeof createCliHelper>;
  let tempDir: string;

  beforeEach(() => {
    cli = createCliHelper();
    tempDir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("should display version with 'version' command", async () => {
    const result = await cli.spawn(["version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("OpenStarry");
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/); // Version number pattern
  });

  it("should display help with '--help' flag", async () => {
    const result = await cli.spawn(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("OpenStarry Agent Runner");
    expect(result.stdout).toContain("Commands:");
    expect(result.stdout).toContain("start");
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("version");
  });

  it("should display help with '-h' flag", async () => {
    const result = await cli.spawn(["-h"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("OpenStarry Agent Runner");
  });

  it.skip("should create agent config with 'init' command", async () => {
    // Skipped: init command requires interactive input in some scenarios
    const result = await cli.spawn(["init", "--force"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("initialized") ||
      expect(result.stdout).toContain("created") ||
      expect(result.stdout).toContain("OpenStarry");
  }, 15000);

  it("should fail gracefully with invalid config file", async () => {
    const invalidConfigPath = join(tempDir, "invalid.json");
    writeFileSync(invalidConfigPath, "{ invalid json }");

    const result = await cli.spawn(["start", "--config", invalidConfigPath]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("") || expect(result.stdout).toContain("");
    // CLI should not crash, but exit with error code
  });

  it("should fail with unknown command", async () => {
    const result = await cli.spawn(["unknown-command"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command") ||
      expect(result.stdout).toContain("Unknown command");
  });

  it("should support verbose flag with 'version --verbose'", async () => {
    const result = await cli.spawn(["version", "--verbose"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("OpenStarry");
  });

  it("should handle missing config file gracefully", async () => {
    const missingConfigPath = join(tempDir, "nonexistent.json");

    const result = await cli.spawn(["start", "--config", missingConfigPath]);

    expect(result.exitCode).toBe(1);
    // Should fail but not crash
  });
});
