/**
 * Plugin Uninstall Command — Remove installed plugins.
 *
 * Usage:
 *   openstarry plugin uninstall <name>
 */

import type { CliCommand, ParsedArgs } from "./base.js";
import { uninstallPlugin } from "../utils/plugin-installer.js";

export class PluginUninstallCommand implements CliCommand {
  name = "plugin-uninstall";
  description = "Uninstall a plugin";

  async execute(args: ParsedArgs): Promise<number> {
    const verbose = args.flags.verbose === true;

    const pluginName = args.positional[0];
    if (!pluginName) {
      console.error("Error: Missing plugin name");
      console.error("Usage: openstarry plugin uninstall <name>");
      return 1;
    }

    const resolvedName = pluginName.startsWith("@")
      ? pluginName
      : `@openstarry-plugin/${pluginName}`;

    console.log(`Uninstalling ${resolvedName}...`);
    const result = await uninstallPlugin(resolvedName, { verbose });

    if (result.success) {
      console.log(`Uninstalled ${resolvedName}`);
      return 0;
    }

    console.error(`Failed to uninstall ${resolvedName}: ${result.error}`);
    return 1;
  }
}
