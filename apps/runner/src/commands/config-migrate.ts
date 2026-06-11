/**
 * Config migrate command — automated config migration between versions.
 * NEW IN v0.33.0-alpha (Plan33 OQ-33-4).
 *
 * Usage: openstarry config migrate [--from <version>] [--to <version>] [--config <path>] [--dry-run]
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CliCommand, ParsedArgs } from "./base.js";
import { findMigrations } from "../migrations/index.js";
import { DEFAULT_AGENT_PATH } from "../bootstrap.js";

const SECRET_KEY_PATTERN = /secret|token|password|key|auth|credential/i;

/** Redact values whose keys match secret patterns in a JSON string. */
function redactSecrets(json: string): string {
  const obj = JSON.parse(json);
  function walk(node: unknown): unknown {
    if (node == null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(walk);
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k) && typeof v === "string") {
        result[k] = "[REDACTED]";
      } else {
        result[k] = walk(v);
      }
    }
    return result;
  }
  return JSON.stringify(walk(obj), null, 2);
}

export class ConfigMigrateCommand implements CliCommand {
  name = "config-migrate";
  description = "Migrate agent config between versions";

  async execute(args: ParsedArgs): Promise<number> {
    const configPath = args.flags.config as string | undefined;
    const fromVersion = (args.flags.from as string) || "0.32";
    const toVersion = (args.flags.to as string) || "0.33";
    const dryRun = args.flags["dry-run"] as boolean;

    const targetPath = configPath
      ? resolve(configPath)
      : existsSync(resolve("agent.json"))
        ? resolve("agent.json")
        : DEFAULT_AGENT_PATH;

    if (!existsSync(targetPath)) {
      console.error(`[FAIL] Config file not found: ${targetPath}`);
      return 1;
    }

    let config: Record<string, unknown>;
    try {
      const content = await readFile(targetPath, "utf-8");
      config = JSON.parse(content) as Record<string, unknown>;
    } catch (err) {
      console.error(`[FAIL] Cannot parse config: ${String(err)}`);
      return 1;
    }

    const applicable = findMigrations(fromVersion, toVersion);
    if (applicable.length === 0) {
      console.log(`No migrations found from v${fromVersion} to v${toVersion}.`);
      return 0;
    }

    console.log(`Migrating: ${targetPath}`);
    console.log(`Path: v${fromVersion} → v${toVersion} (${applicable.length} step${applicable.length > 1 ? "s" : ""})\n`);

    const original = JSON.stringify(config, null, 2);

    for (const migration of applicable) {
      console.log(`  [STEP] v${migration.from} → v${migration.to}`);
      config = migration.transform(config);
    }

    const migrated = JSON.stringify(config, null, 2);

    if (original === migrated) {
      console.log("\nNo changes needed — config is already up to date.");
      return 0;
    }

    if (dryRun) {
      console.log("\n--- Dry run: changes not written ---");
      console.log(redactSecrets(migrated));
      return 0;
    }

    await writeFile(targetPath, migrated + "\n", "utf-8");
    console.log(`\nMigration complete. Config written to: ${targetPath}`);
    return 0;
  }
}
