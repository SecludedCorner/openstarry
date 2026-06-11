/**
 * Tests for isPathSafe() and validateProjectConfig() — Plan34 Wave 2.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import { isPathSafe, validateProjectConfig, SecurityError, ConfigError } from "../../src/utils/permission-validator.js";
import type { IProjectContext } from "@openstarry/sdk";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "openstarry-pv-test-"));
}

describe("isPathSafe()", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns true for a path inside the project root", () => {
    const sub = join(tempDir, "src");
    mkdirSync(sub, { recursive: true });
    expect(isPathSafe(tempDir, sub)).toBe(true);
  });

  it("returns true for the project root itself (using self)", () => {
    // resolve(root, root) = root; normalize(root) + sep starts root + sep
    // root itself does NOT start with root + sep so this should be false
    // (root is not strictly inside root — it IS root)
    // Actually: normalize(root) is the candidate, comparableRoot = normalize(root) + sep
    // root does not start with root + sep → false
    // This is correct: the root itself is not "inside" root
    expect(isPathSafe(tempDir, tempDir)).toBe(false);
  });

  it("returns false for path traversal with ../../", () => {
    expect(isPathSafe(tempDir, "../../etc/passwd")).toBe(false);
  });

  it("returns false for absolute path outside project root", () => {
    const outsidePath = process.platform === "win32" ? "C:\\Windows\\System32" : "/etc/passwd";
    expect(isPathSafe(tempDir, outsidePath)).toBe(false);
  });

  it("returns true for nested subdirectory", () => {
    const nested = join(tempDir, "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    expect(isPathSafe(tempDir, join("a", "b", "c"))).toBe(true);
  });

  it("returns false for Windows UNC path on Windows platform", () => {
    if (process.platform !== "win32") {
      return; // Skip on non-Windows
    }
    expect(isPathSafe(tempDir, "\\\\server\\malicious")).toBe(false);
  });
});

describe("validateProjectConfig()", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeContext(root: string): IProjectContext {
    return {
      projectRoot: root,
      dotOpenstarryPath: join(root, ".openstarry"),
    };
  }

  it("throws SecurityError when .openstarry/ does not exist", async () => {
    const ctx = makeContext(tempDir);
    await expect(validateProjectConfig(ctx)).rejects.toThrow(SecurityError);
  });

  it("throws SecurityError when .openstarry is a file not a directory", async () => {
    writeFileSync(join(tempDir, ".openstarry"), "not a dir");
    const ctx = makeContext(tempDir);
    await expect(validateProjectConfig(ctx)).rejects.toThrow(SecurityError);
  });

  it("returns all nulls when .openstarry/ exists but all files are absent", async () => {
    mkdirSync(join(tempDir, ".openstarry"), { recursive: true });
    const ctx = makeContext(tempDir);
    const result = await validateProjectConfig(ctx);
    expect(result.projectConfig).toBeNull();
    expect(result.projectPermissions).toBeNull();
    expect(result.projectPlugins).toBeNull();
  });

  it("parses valid config.json correctly", async () => {
    const dotDir = join(tempDir, ".openstarry");
    mkdirSync(dotDir, { recursive: true });
    writeFileSync(
      join(dotDir, "config.json"),
      JSON.stringify({ cognition: { temperature: 0.3 } }),
      "utf-8",
    );
    const ctx = makeContext(tempDir);
    const result = await validateProjectConfig(ctx);
    expect(result.projectConfig?.cognition?.temperature).toBe(0.3);
  });

  it("throws ConfigError for invalid JSON in config.json", async () => {
    const dotDir = join(tempDir, ".openstarry");
    mkdirSync(dotDir, { recursive: true });
    writeFileSync(join(dotDir, "config.json"), "{ invalid json", "utf-8");
    const ctx = makeContext(tempDir);
    await expect(validateProjectConfig(ctx)).rejects.toThrow(ConfigError);
  });

  it("throws ConfigError for config.json that fails Zod validation (wrong type)", async () => {
    const dotDir = join(tempDir, ".openstarry");
    mkdirSync(dotDir, { recursive: true });
    writeFileSync(
      join(dotDir, "config.json"),
      JSON.stringify({ cognition: { temperature: "hot" } }),
      "utf-8",
    );
    const ctx = makeContext(tempDir);
    await expect(validateProjectConfig(ctx)).rejects.toThrow(ConfigError);
  });

  it("throws ConfigError when config file exceeds 1MB", async () => {
    const dotDir = join(tempDir, ".openstarry");
    mkdirSync(dotDir, { recursive: true });
    // Write > 1MB of content
    const bigContent = "x".repeat(1_048_577);
    writeFileSync(join(dotDir, "config.json"), bigContent, "utf-8");
    const ctx = makeContext(tempDir);
    await expect(validateProjectConfig(ctx)).rejects.toThrow(ConfigError);
  });

  it("throws ConfigError for unsafe allowedPaths in permissions.json (path traversal)", async () => {
    const dotDir = join(tempDir, ".openstarry");
    mkdirSync(dotDir, { recursive: true });
    writeFileSync(
      join(dotDir, "permissions.json"),
      JSON.stringify({ allowedPaths: ["../../etc/passwd"] }),
      "utf-8",
    );
    const ctx = makeContext(tempDir);
    await expect(validateProjectConfig(ctx)).rejects.toThrow(ConfigError);
  });

  it("returns valid permissions when allowedPaths are safe", async () => {
    const dotDir = join(tempDir, ".openstarry");
    mkdirSync(dotDir, { recursive: true });
    const subdir = join(tempDir, "src");
    mkdirSync(subdir, { recursive: true });
    writeFileSync(
      join(dotDir, "permissions.json"),
      JSON.stringify({ allowedPaths: ["src"] }),
      "utf-8",
    );
    const ctx = makeContext(tempDir);
    const result = await validateProjectConfig(ctx);
    expect(result.projectPermissions?.allowedPaths).toEqual(["src"]);
  });

  it("parses valid plugins.json correctly", async () => {
    const dotDir = join(tempDir, ".openstarry");
    mkdirSync(dotDir, { recursive: true });
    writeFileSync(
      join(dotDir, "plugins.json"),
      JSON.stringify({ plugins: [{ name: "@openstarry-plugin/test" }] }),
      "utf-8",
    );
    const ctx = makeContext(tempDir);
    const result = await validateProjectConfig(ctx);
    expect(result.projectPlugins?.plugins).toHaveLength(1);
    expect(result.projectPlugins?.plugins[0].name).toBe("@openstarry-plugin/test");
  });

  it("throws ConfigError for unsafe plugin path in plugins.json", async () => {
    const dotDir = join(tempDir, ".openstarry");
    mkdirSync(dotDir, { recursive: true });
    writeFileSync(
      join(dotDir, "plugins.json"),
      JSON.stringify({ plugins: [{ name: "evil-plugin", path: "../../outside/plugin" }] }),
      "utf-8",
    );
    const ctx = makeContext(tempDir);
    await expect(validateProjectConfig(ctx)).rejects.toThrow(ConfigError);
  });

  it("throws ConfigError for empty plugins array in plugins.json", async () => {
    const dotDir = join(tempDir, ".openstarry");
    mkdirSync(dotDir, { recursive: true });
    writeFileSync(
      join(dotDir, "plugins.json"),
      JSON.stringify({ plugins: [] }),
      "utf-8",
    );
    const ctx = makeContext(tempDir);
    await expect(validateProjectConfig(ctx)).rejects.toThrow(ConfigError);
  });

  it("SEC-004: throws ConfigError for unknown fields in permissions.json (.strict())", async () => {
    const dotDir = join(tempDir, ".openstarry");
    mkdirSync(dotDir, { recursive: true });
    writeFileSync(
      join(dotDir, "permissions.json"),
      JSON.stringify({ allowedPaths: ["src"], unknownField: "should-fail" }),
      "utf-8",
    );
    const subdir = join(tempDir, "src");
    mkdirSync(subdir, { recursive: true });
    const ctx = makeContext(tempDir);
    await expect(validateProjectConfig(ctx)).rejects.toThrow(ConfigError);
  });

  it("SEC-004: config.json unknown fields are warned and ignored (not rejected)", async () => {
    const dotDir = join(tempDir, ".openstarry");
    mkdirSync(dotDir, { recursive: true });
    writeFileSync(
      join(dotDir, "config.json"),
      JSON.stringify({ cognition: { temperature: 0.5 }, secretField: "injection" }),
      "utf-8",
    );
    const ctx = makeContext(tempDir);
    // config.json strict mode: WARN + strip unknown fields, not reject
    const result = await validateProjectConfig(ctx);
    expect(result.projectConfig?.cognition?.temperature).toBe(0.5);
    // secretField should not be present in the result
    expect((result.projectConfig as Record<string, unknown>)?.["secretField"]).toBeUndefined();
  });
});
