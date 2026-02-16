/**
 * Version command - display version information.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CliCommand, ParsedArgs } from "./base.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class VersionCommand implements CliCommand {
  name = "version";
  description = "Display version information";

  async execute(args: ParsedArgs): Promise<number> {
    try {
      const pkgPath = resolve(__dirname, "../../package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

      console.log(`OpenStarry v${pkg.version}`);

      if (args.flags.verbose) {
        console.log(`Node.js ${process.version}`);
        console.log(`Platform: ${process.platform} ${process.arch}`);
      }

      return 0;
    } catch (err) {
      console.error("Failed to read version information");
      return 1;
    }
  }
}
