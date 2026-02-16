/**
 * Plugin Info Command — Show details about a specific plugin.
 *
 * Usage:
 *   openstarry plugin info <name>
 */

import type { CliCommand, ParsedArgs } from "./base.js";
import { getCatalogEntry } from "../utils/plugin-catalog.js";
import { readLockFile } from "../utils/plugin-lock.js";

export class PluginInfoCommand implements CliCommand {
  name = "plugin-info";
  description = "Show plugin details";

  async execute(args: ParsedArgs): Promise<number> {
    const pluginName = args.positional[0];
    if (!pluginName) {
      console.error("Error: Missing plugin name");
      console.error("Usage: openstarry plugin info <name>");
      return 1;
    }

    const resolvedName = pluginName.startsWith("@")
      ? pluginName
      : `@openstarry-plugin/${pluginName}`;

    const entry = getCatalogEntry(resolvedName);
    if (!entry) {
      console.error(`Plugin "${resolvedName}" not found in catalog`);
      return 1;
    }

    const lock = await readLockFile();
    const lockEntry = lock.plugins[resolvedName];

    console.log(`Plugin: ${entry.name}`);
    console.log(`Version: ${entry.version}`);
    console.log(`Description: ${entry.description}`);
    console.log(`Aggregates: ${entry.aggregates.join(", ") || "none"}`);
    console.log(`Tags: ${entry.tags.join(", ")}`);
    console.log(`Status: ${lockEntry ? "installed" : "not installed"}`);
    if (lockEntry) {
      console.log(`Installed: ${lockEntry.installedAt}`);
    }
    return 0;
  }
}
