/**
 * Plugin compound command routing tests.
 *
 * Tests that `openstarry plugin <subcommand>` routes correctly to
 * the appropriate command handler via bin.ts argument parsing.
 */

import { describe, it, expect } from "vitest";
import { parseArgs } from "../../src/utils/args.js";
import { PluginInstallCommand } from "../../src/commands/plugin-install.js";
import { PluginUninstallCommand } from "../../src/commands/plugin-uninstall.js";
import { PluginListCommand } from "../../src/commands/plugin-list.js";
import { PluginSearchCommand } from "../../src/commands/plugin-search.js";
import { PluginInfoCommand } from "../../src/commands/plugin-info.js";
import { PluginSyncCommand } from "../../src/commands/plugin-sync.js";

/**
 * Simulate the bin.ts compound command resolution logic.
 */
function resolveCommandName(argv: string[]): { commandName: string; positional: string[] } {
  const parsed = parseArgs(argv);
  let commandName = parsed.command;

  if (parsed.command === "plugin" && parsed.positional.length > 0) {
    const subcommand = parsed.positional[0];
    const pluginSubcommands = ["sync", "install", "uninstall", "list", "search", "info"];
    if (pluginSubcommands.includes(subcommand)) {
      commandName = `plugin-${subcommand}`;
      parsed.positional.shift();
    }
  }

  return { commandName, positional: parsed.positional };
}

describe("Plugin command routing", () => {
  it("routes 'plugin install' to plugin-install", () => {
    const { commandName } = resolveCommandName(["plugin", "install", "foo"]);
    expect(commandName).toBe("plugin-install");
    expect(new PluginInstallCommand().name).toBe("plugin-install");
  });

  it("routes 'plugin uninstall' to plugin-uninstall", () => {
    const { commandName } = resolveCommandName(["plugin", "uninstall", "foo"]);
    expect(commandName).toBe("plugin-uninstall");
    expect(new PluginUninstallCommand().name).toBe("plugin-uninstall");
  });

  it("routes 'plugin list' to plugin-list", () => {
    const { commandName } = resolveCommandName(["plugin", "list"]);
    expect(commandName).toBe("plugin-list");
    expect(new PluginListCommand().name).toBe("plugin-list");
  });

  it("routes 'plugin search' to plugin-search", () => {
    const { commandName } = resolveCommandName(["plugin", "search", "transport"]);
    expect(commandName).toBe("plugin-search");
    expect(new PluginSearchCommand().name).toBe("plugin-search");
  });

  it("routes 'plugin info' to plugin-info", () => {
    const { commandName } = resolveCommandName(["plugin", "info", "fs"]);
    expect(commandName).toBe("plugin-info");
    expect(new PluginInfoCommand().name).toBe("plugin-info");
  });

  it("routes 'plugin sync' to plugin-sync", () => {
    const { commandName } = resolveCommandName(["plugin", "sync", "/path"]);
    expect(commandName).toBe("plugin-sync");
    expect(new PluginSyncCommand().name).toBe("plugin-sync");
  });

  it("passes remaining positional args after subcommand", () => {
    const { positional } = resolveCommandName(["plugin", "install", "my-plugin"]);
    expect(positional).toEqual(["my-plugin"]);
  });

  it("preserves flags through compound routing", () => {
    const parsed = parseArgs(["plugin", "install", "--all", "--force"]);
    expect(parsed.flags.all).toBe(true);
    expect(parsed.flags.force).toBe(true);
  });

  it("routes 'plugin install --all' correctly", () => {
    const parsed = parseArgs(["plugin", "install", "--all"]);
    expect(parsed.command).toBe("plugin");
    expect(parsed.positional[0]).toBe("install");
    expect(parsed.flags.all).toBe(true);
  });
});
