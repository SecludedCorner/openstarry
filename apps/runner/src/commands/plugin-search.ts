/**
 * Plugin Search Command — Search catalog by keyword.
 *
 * Usage:
 *   openstarry plugin search <query>
 */

import type { CliCommand, ParsedArgs } from "./base.js";
import { searchCatalog } from "../utils/plugin-catalog.js";

export class PluginSearchCommand implements CliCommand {
  name = "plugin-search";
  description = "Search the plugin catalog";

  async execute(args: ParsedArgs): Promise<number> {
    const query = args.positional[0];
    if (!query) {
      console.error("Error: Missing search query");
      console.error("Usage: openstarry plugin search <query>");
      return 1;
    }

    const results = searchCatalog(query);

    if (results.length === 0) {
      console.log(`No plugins found matching "${query}"`);
      return 0;
    }

    console.log(`Found ${results.length} plugin(s) matching "${query}":\n`);
    for (const entry of results) {
      console.log(`  ${entry.name} (${entry.version})`);
      console.log(`    ${entry.description}`);
      console.log(`    Aggregates: ${entry.aggregates.join(", ") || "none"}`);
      console.log(`    Tags: ${entry.tags.join(", ")}`);
      console.log("");
    }
    return 0;
  }
}
