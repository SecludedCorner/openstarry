/**
 * Base command interface for all CLI subcommands.
 *
 * FROZEN INTERFACE (from Architecture Spec)
 */

export interface ParsedArgs {
  /** Command name (e.g., "start") */
  command: string;

  /** Named flags (e.g., { config: "./agent.json", verbose: true }) */
  flags: Record<string, string | boolean>;

  /** Positional arguments (e.g., ["arg1", "arg2"]) */
  positional: string[];
}

export interface CliCommand {
  /** Command name (e.g., "start", "init", "version") */
  name: string;

  /** Command description for help text */
  description: string;

  /** Execute the command with parsed arguments */
  execute(args: ParsedArgs): Promise<number>; // Exit code: 0 = success, 1+ = error
}
