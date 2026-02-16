/**
 * Start command - launch an agent from configuration.
 *
 * Refactored from bin.ts, now as a proper command.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { IAgentConfig } from "@openstarry/sdk";
import { AgentEventType } from "@openstarry/sdk";
import { createAgentCore } from "@openstarry/core";
import type { CliCommand, ParsedArgs } from "./base.js";
import { bootstrap, DEFAULT_AGENT_PATH } from "../bootstrap.js";
import { validateConfig } from "../utils/config-validator.js";
import { resolvePlugins } from "../utils/plugin-resolver.js";
import type { ConfigValidationError } from "../utils/config-validator.js";

export class StartCommand implements CliCommand {
  name = "start";
  description = "Start an agent from configuration";

  async execute(args: ParsedArgs): Promise<number> {
    // 1. Extract flags
    const configPath = args.flags.config as string | undefined;
    const verbose = args.flags.verbose as boolean;

    // 2. Bootstrap
    const { isFirstRun } = await bootstrap();

    // 3. Load config
    const targetConfigPath = configPath
      ? resolve(configPath)
      : existsSync(resolve("agent.json"))
        ? resolve("agent.json")
        : DEFAULT_AGENT_PATH;
    let config: IAgentConfig;

    try {
      config = await this.loadConfig(targetConfigPath);
      if (!isFirstRun || configPath) {
        console.error(`[cli] Loaded config: ${targetConfigPath}`);
      }
    } catch (err) {
      console.error(
        `[cli] Failed to load config ${targetConfigPath}: ${err instanceof Error ? err.message : String(err)}`
      );
      return 1;
    }

    // 4. Validate config
    const validation = validateConfig(config);
    if (!validation.valid) {
      this.printValidationErrors(validation.errors!);
      return 1;
    }

    // Print warnings if any
    if (validation.errors?.length) {
      for (const w of validation.errors) {
        console.warn(`[cli] Warning: ${w.message} (${w.path})`);
      }
    }

    // Ensure allowedPaths includes cwd
    if (
      !validation.config!.capabilities.allowedPaths ||
      validation.config!.capabilities.allowedPaths.length === 0
    ) {
      validation.config!.capabilities.allowedPaths = [process.cwd()];
    }

    // 5. Create core
    const core = createAgentCore(validation.config!);

    // 6. Load plugins
    const pluginResult = await resolvePlugins(validation.config!, verbose);
    for (const plugin of pluginResult.plugins) {
      await core.loadPlugin(plugin);
    }

    // If all plugins failed to load, exit
    if (pluginResult.plugins.length === 0 && pluginResult.errors.length > 0) {
      console.error("[cli] No plugins loaded successfully. Cannot start agent.");
      return 1;
    }

    // 7. Start
    await core.start();

    // 8. Block until shutdown signal
    return new Promise<number>((resolve) => {
      let shuttingDown = false;

      const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\nShutting down (${signal})...`);
        await core.stop();
        resolve(0);
      };

      process.on("SIGINT", () => { shutdown("SIGINT").catch(() => resolve(1)); });
      process.on("SIGTERM", () => { shutdown("SIGTERM").catch(() => resolve(1)); });

      core.bus.on(AgentEventType.MESSAGE_SYSTEM, (event) => {
        const payload = event.payload as { text?: string } | undefined;
        if (payload?.text === "__QUIT__") {
          console.log("\nGoodbye!");
          shutdown("QUIT").catch(() => resolve(1));
        }
      });
    });
  }

  private async loadConfig(configPath: string): Promise<IAgentConfig> {
    const raw = await readFile(configPath, "utf-8");
    const json: unknown = JSON.parse(raw);
    return json as IAgentConfig; // Validation happens separately
  }

  private printValidationErrors(errors: ConfigValidationError[]): void {
    console.error("[cli] Config validation failed:\n");

    for (const err of errors) {
      const severity = err.severity.toUpperCase();
      console.error(`${severity}: ${err.path}`);
      console.error(`  ${err.message}`);
      if (err.suggestion) {
        console.error(`  Suggestion: ${err.suggestion}`);
      }
      console.error("");
    }

    console.error("Fix these errors and try again.");
  }
}
