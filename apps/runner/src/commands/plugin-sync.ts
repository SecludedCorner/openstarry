/**
 * Plugin Sync Command — Sync plugins from source repository to system directory.
 *
 * Command: openstarry plugin sync <path> [--verbose] [--force] [--dry-run]
 */

import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { CliCommand, ParsedArgs } from "./base.js";
import { bootstrap, PLUGINS_DIR } from "../bootstrap.js";
import {
  scanPluginDirectory,
  shouldSyncPlugin,
  syncPlugin,
  type PluginInfo,
} from "../utils/plugin-scanner.js";

export class PluginSyncCommand implements CliCommand {
  name = "plugin-sync";
  description = "Sync plugins from a source repository to system directory";

  async execute(args: ParsedArgs): Promise<number> {
    // 1. Parse arguments
    const sourcePath = args.positional[0];
    const verbose = args.flags.verbose === true;
    const force = args.flags.force === true;
    const dryRun = args.flags["dry-run"] === true;
    const skipDeps = args.flags["skip-deps"] === true;

    if (!sourcePath) {
      console.error("Error: Missing required argument <path>");
      console.error("Usage: openstarry plugin sync <path> [--verbose] [--force] [--dry-run] [--skip-deps]");
      return 1;
    }

    // 2. Resolve source directory path
    const resolvedSourcePath = resolve(sourcePath);

    if (!existsSync(resolvedSourcePath)) {
      console.error(`Error: Source directory not found: ${resolvedSourcePath}`);
      return 1;
    }

    // 3. Ensure system plugin directory exists (via bootstrap)
    await bootstrap();
    const systemPluginDir = join(PLUGINS_DIR, "installed");
    await mkdir(systemPluginDir, { recursive: true });

    // 4. Scan source directory for valid plugins
    let scanResult;
    try {
      scanResult = await scanPluginDirectory(resolvedSourcePath);
    } catch (err) {
      console.error(`Error: Failed to scan source directory: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }

    if (verbose) {
      console.log(`Found ${scanResult.plugins.length} plugins in ${resolvedSourcePath}`);
      if (scanResult.skipped.length > 0) {
        console.log(`Skipped ${scanResult.skipped.length} invalid entries:`);
        for (const skipped of scanResult.skipped) {
          console.log(`  - ${skipped.path}: ${skipped.reason}`);
        }
      }
    }

    if (scanResult.plugins.length === 0) {
      console.log("No valid plugins found to sync.");
      return 0;
    }

    // 5. For each plugin, check if sync needed and perform sync
    let syncedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const plugin of scanResult.plugins) {
      const targetPath = join(systemPluginDir, plugin.name);

      try {
        // Check if sync needed (unless --force)
        const needsSync = force || (await shouldSyncPlugin(plugin.sourcePath, targetPath));

        if (!needsSync) {
          skippedCount++;
          if (verbose) {
            console.log(`  [skip] ${plugin.name} (already up-to-date)`);
          }
          continue;
        }

        // Log intent
        if (dryRun) {
          console.log(`  [dry-run] Would sync ${plugin.name} ${plugin.version}`);
          skippedCount++;
          continue;
        }

        // Perform sync
        if (verbose) {
          console.log(`  [sync] ${plugin.name} ${plugin.version}`);
        } else {
          // In non-verbose mode, we'll print synced plugins at the end
        }

        await syncPlugin(plugin.sourcePath, targetPath, { skipDeps, verbose });
        syncedCount++;
      } catch (err) {
        errorCount++;
        console.error(`  [error] ${plugin.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 6. Print summary
    if (!verbose && !dryRun && syncedCount > 0) {
      // Print synced plugins in non-verbose mode
      const rescan = await scanPluginDirectory(resolvedSourcePath);
      for (const plugin of rescan.plugins) {
        const targetPath = join(systemPluginDir, plugin.name);
        if (existsSync(targetPath)) {
          const needsSync = force || (await shouldSyncPlugin(plugin.sourcePath, targetPath));
          if (force || !needsSync) {
            console.log(`  [sync] ${plugin.name} ${plugin.version}`);
          }
        }
      }
    }

    console.log(`\nSync complete: ${syncedCount} synced, ${skippedCount} skipped, ${errorCount} errors`);

    return errorCount > 0 ? 1 : 0;
  }
}
