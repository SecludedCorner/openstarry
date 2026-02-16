/**
 * Plugin Install Command — Install plugins from catalog.
 *
 * Usage:
 *   openstarry plugin install <name>     Install a single plugin
 *   openstarry plugin install --all      Install all 15 official plugins
 *   openstarry plugin install --force    Reinstall even if already installed
 */

import type { CliCommand, ParsedArgs } from "./base.js";
import { installPlugin, installAll } from "../utils/plugin-installer.js";
import { getCatalogEntry } from "../utils/plugin-catalog.js";

export class PluginInstallCommand implements CliCommand {
  name = "plugin-install";
  description = "Install plugins from the official catalog";

  async execute(args: ParsedArgs): Promise<number> {
    const force = args.flags.force === true;
    const verbose = args.flags.verbose === true;
    const all = args.flags.all === true;

    if (all) {
      console.log("Installing all official plugins...\n");
      const result = await installAll({ force, verbose });
      console.log(
        `\nDone: ${result.installed.length} installed, ${result.skipped.length} skipped, ${result.failed.length} failed`,
      );
      return result.failed.length > 0 ? 1 : 0;
    }

    const pluginName = args.positional[0];
    if (!pluginName) {
      console.error("Error: Missing plugin name");
      console.error("Usage: openstarry plugin install <name> [--force]");
      console.error("       openstarry plugin install --all");
      return 1;
    }

    // Normalize name: accept short form "fs" → "@openstarry-plugin/standard-function-fs"
    const resolvedName = resolvePluginName(pluginName);

    const entry = getCatalogEntry(resolvedName);
    if (!entry) {
      console.error(`Error: Plugin "${resolvedName}" not found in catalog`);
      console.error("Use 'openstarry plugin search <query>' to find available plugins.");
      return 1;
    }

    console.log(`Installing ${resolvedName}...`);
    const result = await installPlugin(resolvedName, { force, verbose });

    if (result.success) {
      console.log(`Installed ${resolvedName}`);
      return 0;
    }

    console.error(`Failed to install ${resolvedName}: ${result.error}`);
    return 1;
  }
}

/**
 * Resolve shorthand plugin names to full package names.
 * If already a full name (starts with @), return as-is.
 */
function resolvePluginName(input: string): string {
  if (input.startsWith("@")) {
    return input;
  }
  return `@openstarry-plugin/${input}`;
}
