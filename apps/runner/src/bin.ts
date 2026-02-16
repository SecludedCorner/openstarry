#!/usr/bin/env node

/**
 * Runner Entry Point — CLI subcommand router.
 *
 * Supports:
 *   - openstarry start [--config <path>] [--verbose]
 *   - openstarry init [--force]
 *   - openstarry version [--verbose]
 *   - openstarry (no args) → defaults to "start"
 *
 * Backward compatibility:
 *   - node dist/bin.js --config ./agent.json → still works (defaults to start)
 */

import { parseArgs } from "./utils/args.js";
import { StartCommand } from "./commands/start.js";
import { InitCommand } from "./commands/init.js";
import { VersionCommand } from "./commands/version.js";
import { DaemonStartCommand } from "./commands/daemon-start.js";
import { DaemonStopCommand } from "./commands/daemon-stop.js";
import { PsCommand } from "./commands/ps.js";
import { AttachCommand } from "./commands/attach.js";
import { CreatePluginCommand } from "./commands/create-plugin.js";
import { PluginSyncCommand } from "./commands/plugin-sync.js";
import { PluginInstallCommand } from "./commands/plugin-install.js";
import { PluginUninstallCommand } from "./commands/plugin-uninstall.js";
import { PluginListCommand } from "./commands/plugin-list.js";
import { PluginSearchCommand } from "./commands/plugin-search.js";
import { PluginInfoCommand } from "./commands/plugin-info.js";

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));

  // Handle --help / -h
  if (parsed.flags.help === true || parsed.flags.h === true) {
    console.log("OpenStarry Agent Runner");
    console.log("");
    console.log("Usage: openstarry <command> [options]");
    console.log("");
    console.log("Commands:");
    console.log("  start          Start an agent from configuration (default)");
    console.log("  daemon start   Start agent in background daemon mode");
    console.log("  daemon stop    Stop a running daemon");
    console.log("  attach         Attach to a running daemon session");
    console.log("  ps             List running agents");
    console.log("  init           Initialize OpenStarry configuration");
    console.log("  create-plugin  Scaffold a new OpenStarry plugin package");
    console.log("  plugin install  Install plugins from the official catalog");
    console.log("  plugin uninstall Remove an installed plugin");
    console.log("  plugin list    List installed or available plugins");
    console.log("  plugin search  Search the plugin catalog");
    console.log("  plugin info    Show plugin details");
    console.log("  plugin sync    Sync plugins from a source repository to system directory");
    console.log("  version        Show version information");
    console.log("");
    console.log("Options:");
    console.log("  --config <path>  Path to agent config file");
    console.log("  --verbose        Show detailed output");
    console.log("  --help, -h       Show this help message");
    return 0;
  }

  // Handle compound commands (daemon start, daemon stop, plugin sync)
  let commandName = parsed.command;
  if (parsed.command === "daemon" && parsed.positional.length > 0) {
    const subcommand = parsed.positional[0];
    if (subcommand === "start" || subcommand === "stop") {
      commandName = `daemon-${subcommand}`;
      parsed.positional.shift();
    }
  }
  if (parsed.command === "plugin" && parsed.positional.length > 0) {
    const subcommand = parsed.positional[0];
    const pluginSubcommands = ["sync", "install", "uninstall", "list", "search", "info"];
    if (pluginSubcommands.includes(subcommand)) {
      commandName = `plugin-${subcommand}`;
      parsed.positional.shift();
    }
  }

  // Subcommand routing
  const commands = [
    new StartCommand(),
    new InitCommand(),
    new VersionCommand(),
    new DaemonStartCommand(),
    new DaemonStopCommand(),
    new AttachCommand(),
    new PsCommand(),
    new CreatePluginCommand(),
    new PluginSyncCommand(),
    new PluginInstallCommand(),
    new PluginUninstallCommand(),
    new PluginListCommand(),
    new PluginSearchCommand(),
    new PluginInfoCommand(),
  ];

  const command = commands.find(cmd => cmd.name === commandName);

  if (!command) {
    // Default: no command = "start" (backward compatibility)
    if (parsed.command === "") {
      return new StartCommand().execute(parsed);
    }
    console.error(`Unknown command: ${parsed.command}`);
    console.error(`Available commands: start, daemon start, daemon stop, attach, ps, init, create-plugin, plugin install, plugin uninstall, plugin list, plugin search, plugin info, plugin sync, version`);
    return 1;
  }

  return command.execute(parsed);
}

// Always run — this file is the CLI entry point
main()
  .then(exitCode => process.exit(exitCode))
  .catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
