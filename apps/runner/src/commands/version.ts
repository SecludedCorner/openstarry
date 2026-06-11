/**
 * Version command - display version information.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CliCommand, ParsedArgs } from "./base.js";
import { findProjectRoot } from "../utils/project-detector.js";

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

        // [Plan34 W3] Show project config info
        const context = findProjectRoot();
        if (context) {
          const files = ["config.json", "permissions.json", "plugins.json"]
            .filter(f => existsSync(join(context.dotOpenstarryPath, f)));
          console.log(`Project root: ${context.projectRoot}`);
          console.log(`Project config: ${context.dotOpenstarryPath} [${files.join(", ") || "no files"}]`);
        } else {
          console.log(`Project root: none`);
        }
      }

      return 0;
    } catch (err) {
      console.error("Failed to read version information");
      return 1;
    }
  }
}
