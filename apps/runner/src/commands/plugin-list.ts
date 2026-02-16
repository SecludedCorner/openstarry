/**
 * Plugin List Command — Show installed and available plugins.
 *
 * Usage:
 *   openstarry plugin list          Show installed plugins
 *   openstarry plugin list --all    Show all catalog plugins (installed/available)
 */

import type { CliCommand, ParsedArgs } from "./base.js";
import { getAllCatalogEntries } from "../utils/plugin-catalog.js";
import { readLockFile } from "../utils/plugin-lock.js";

export class PluginListCommand implements CliCommand {
  name = "plugin-list";
  description = "List installed or available plugins";

  async execute(args: ParsedArgs): Promise<number> {
    const showAll = args.flags.all === true;
    const lock = await readLockFile();
    const installedNames = new Set(Object.keys(lock.plugins));

    if (showAll) {
      const entries = getAllCatalogEntries();
      console.log("Official Plugin Catalog:\n");
      for (const entry of entries) {
        const status = installedNames.has(entry.name) ? "[installed]" : "[available]";
        console.log(`  ${status} ${entry.name} (${entry.version})`);
        console.log(`           ${entry.description}`);
      }
      console.log(`\n${installedNames.size} installed, ${entries.length - installedNames.size} available`);
      return 0;
    }

    // Show installed only
    if (installedNames.size === 0) {
      console.log("No plugins installed.");
      console.log("Use 'openstarry plugin install --all' to install all official plugins.");
      return 0;
    }

    console.log("Installed plugins:\n");
    for (const [name, entry] of Object.entries(lock.plugins)) {
      console.log(`  ${name} (${entry.version})`);
      console.log(`    Installed: ${entry.installedAt}`);
    }
    console.log(`\n${installedNames.size} plugin(s) installed`);
    return 0;
  }
}
