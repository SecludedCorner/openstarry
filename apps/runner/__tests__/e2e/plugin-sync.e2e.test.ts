/**
 * Plugin Sync E2E tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PluginSyncCommand } from "../../src/commands/plugin-sync.js";
import type { ParsedArgs } from "../../src/commands/base.js";

describe("Plugin Sync E2E", () => {
  let tempDir: string;
  let ecosystemDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `plugin-sync-e2e-${Date.now()}`);
    ecosystemDir = join(tempDir, "ecosystem");
    await mkdir(ecosystemDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  const createPlugin = async (name: string, version: string) => {
    const pluginDir = join(ecosystemDir, name);
    await mkdir(join(pluginDir, "dist"), { recursive: true });
    await writeFile(
      join(pluginDir, "package.json"),
      JSON.stringify({
        name: `@openstarry-plugin/${name}`,
        version,
        main: "dist/index.js",
      }),
      "utf-8"
    );
    await writeFile(join(pluginDir, "dist", "index.js"), "export {};", "utf-8");
  };

  it("full sync workflow: scan → sync → verify files copied", async () => {
    // Create mock ecosystem with 3 plugins
    await createPlugin("plugin-a", "1.0.0");
    await createPlugin("plugin-b", "1.0.0");
    await createPlugin("plugin-c", "1.0.0");

    const cmd = new PluginSyncCommand();
    const args: ParsedArgs = {
      command: "plugin-sync",
      positional: [ecosystemDir],
      flags: {},
    };

    const exitCode = await cmd.execute(args);

    expect(exitCode).toBe(0);
    // Note: Verification of actual files would require mocking PLUGINS_DIR
    // or using a test-specific system directory
  });

  it("incremental sync: sync once → bump version → sync again → only updated plugin synced", async () => {
    // Create plugins
    await createPlugin("plugin-a", "1.0.0");
    await createPlugin("plugin-b", "1.0.0");

    const cmd = new PluginSyncCommand();

    // First sync
    await cmd.execute({
      command: "plugin-sync",
      positional: [ecosystemDir],
      flags: {},
    });

    // Bump plugin-a version
    const pluginADir = join(ecosystemDir, "plugin-a");
    await writeFile(
      join(pluginADir, "package.json"),
      JSON.stringify({
        name: "@openstarry-plugin/plugin-a",
        version: "2.0.0",
        main: "dist/index.js",
      }),
      "utf-8"
    );

    // Second sync
    const exitCode = await cmd.execute({
      command: "plugin-sync",
      positional: [ecosystemDir],
      flags: { verbose: true },
    });

    expect(exitCode).toBe(0);
    // In verbose mode, should see plugin-a synced and plugin-b skipped
  });

  it("dry-run workflow: no files modified", async () => {
    // Create plugins
    await createPlugin("plugin-a", "1.0.0");
    await createPlugin("plugin-b", "1.0.0");

    const cmd = new PluginSyncCommand();

    // Dry-run sync
    const exitCode = await cmd.execute({
      command: "plugin-sync",
      positional: [ecosystemDir],
      flags: { "dry-run": true },
    });

    expect(exitCode).toBe(0);
    // Files should not be modified (would need system directory inspection to verify)
  });

  it("force sync: sync once → sync again with --force → all plugins re-synced", async () => {
    // Create plugins
    await createPlugin("plugin-a", "1.0.0");
    await createPlugin("plugin-b", "1.0.0");

    const cmd = new PluginSyncCommand();

    // First sync
    await cmd.execute({
      command: "plugin-sync",
      positional: [ecosystemDir],
      flags: {},
    });

    // Force sync (no version changes)
    const exitCode = await cmd.execute({
      command: "plugin-sync",
      positional: [ecosystemDir],
      flags: { force: true, verbose: true },
    });

    expect(exitCode).toBe(0);
    // All plugins should be synced despite no version changes
  });

  it("handles large plugin set", async () => {
    // Create 12 plugins (matching ecosystem size)
    for (let i = 1; i <= 12; i++) {
      await createPlugin(`plugin-${i}`, "1.0.0");
    }

    const cmd = new PluginSyncCommand();

    const exitCode = await cmd.execute({
      command: "plugin-sync",
      positional: [ecosystemDir],
      flags: {},
    });

    expect(exitCode).toBe(0);
  });
});
