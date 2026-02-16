/**
 * CLI argument parser.
 *
 * Hand-rolled minimal parser (~60 lines) - no external CLI framework needed.
 */

import type { ParsedArgs } from "../commands/base.js";

/**
 * Parse CLI arguments into structured ParsedArgs.
 *
 * Supported formats:
 *   - Long flag with value: --config ./agent.json
 *   - Boolean flag: --verbose
 *   - Short flag: -v (treated as boolean)
 *   - Command: first non-flag argument
 *   - Positional: remaining non-flag arguments
 *
 * Examples:
 *   parseArgs(["start", "--config", "./agent.json"]) → { command: "start", flags: { config: "./agent.json" }, positional: [] }
 *   parseArgs(["init", "--force"]) → { command: "init", flags: { force: true }, positional: [] }
 *   parseArgs(["--verbose"]) → { command: "", flags: { verbose: true }, positional: [] }
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command = "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // Long flag with value: --config ./agent.json
    if (arg.startsWith("--") && argv[i + 1] && !argv[i + 1].startsWith("-")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      flags[key] = value;
      i++; // Skip next
      continue;
    }

    // Boolean flag: --verbose
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      flags[key] = true;
      continue;
    }

    // Short flag: -v
    if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      flags[key] = true;
      continue;
    }

    // First non-flag = command
    if (!command && !arg.startsWith("-")) {
      command = arg;
      continue;
    }

    // Remaining non-flags = positional
    if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  return { command, flags, positional };
}
