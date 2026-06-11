/**
 * Config validate command — validate agent config without starting.
 * NEW IN v0.33.0-alpha (Plan33 OQ-33-2).
 *
 * Checks: schema, types, plugin references, dependencies, criticality, SDK default diff.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CliCommand, ParsedArgs } from "./base.js";
import { validateConfig } from "../utils/config-validator.js";
import { DEFAULT_AGENT_PATH } from "../bootstrap.js";

export class ConfigValidateCommand implements CliCommand {
  name = "config-validate";
  description = "Validate an agent configuration file";

  async execute(args: ParsedArgs): Promise<number> {
    const configPath = args.flags.config as string | undefined;

    const targetPath = configPath
      ? resolve(configPath)
      : existsSync(resolve("agent.json"))
        ? resolve("agent.json")
        : DEFAULT_AGENT_PATH;

    if (!existsSync(targetPath)) {
      console.error(`[FAIL] Config file not found: ${targetPath}`);
      return 1;
    }

    let rawConfig: unknown;
    try {
      const content = await readFile(targetPath, "utf-8");
      rawConfig = JSON.parse(content);
    } catch (err) {
      console.error(`[FAIL] Cannot parse config: ${String(err)}`);
      return 1;
    }

    console.log(`Validating: ${targetPath}\n`);

    // Run existing validation
    const result = validateConfig(rawConfig);

    if (result.errors && result.errors.length > 0) {
      for (const err of result.errors) {
        const tag = err.severity === "error" ? "[FAIL]" : "[WARN]";
        console.log(`${tag}  ${err.path}: ${err.message}`);
        if (err.suggestion) {
          console.log(`       Suggestion: ${err.suggestion}`);
        }
      }
    }

    // Check plugin references against catalog
    const config = rawConfig as Record<string, unknown>;
    const plugins = config.plugins as Array<{ name: string }> | undefined;
    if (plugins && Array.isArray(plugins)) {
      // Check context-sliding-window (Required plugin)
      const hasContextManager = plugins.some(
        p => p.name === "@openstarry-plugin/context-sliding-window"
      );
      if (!hasContextManager) {
        console.log(`[FAIL] Required plugin "@openstarry-plugin/context-sliding-window" is not configured`);
        if (result.valid) {
          return 1;
        }
      } else {
        console.log(`[OK]   Criticality: context-sliding-window present (required)`);
      }

      console.log(`[OK]   Plugins: ${plugins.length} configured`);
    }

    if (result.valid) {
      const warnCount = result.errors?.filter(e => e.severity === "warning").length ?? 0;
      console.log(`\nValidation passed${warnCount > 0 ? ` with ${warnCount} warning(s)` : ""}.`);
      return 0;
    } else {
      const errCount = result.errors?.filter(e => e.severity === "error").length ?? 0;
      console.log(`\nValidation failed with ${errCount} error(s).`);
      return 1;
    }
  }
}
