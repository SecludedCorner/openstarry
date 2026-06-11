/**
 * Start command - launch an agent from configuration.
 *
 * Refactored from bin.ts, now as a proper command.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { IAgentConfig, IProjectPermissions } from "@openstarry/sdk";
import { AgentEventType } from "@openstarry/sdk";
import { createAgentCore } from "@openstarry/core";
import type { CliCommand, ParsedArgs } from "./base.js";
import { bootstrap, DEFAULT_AGENT_PATH } from "../bootstrap.js";
import { validateConfig } from "../utils/config-validator.js";
import { resolvePlugins } from "../utils/plugin-resolver.js";
import { wrapPluginWithToolFilter, capturePluginHooks } from "../utils/tool-filter-proxy.js";
import { createCheckpointManager } from "../utils/checkpoint-manager.js";
import {
  readSnapshotStore,
  writeSnapshotStore,
} from "../utils/snapshot-store.js";
import { NonceRegistry } from "../utils/snapshot-hmac.js";
import type { PluginHooks } from "@openstarry/sdk";
import type { ConfigValidationError } from "../utils/config-validator.js";
import { findProjectRoot } from "../utils/project-detector.js";
import { validateProjectConfig } from "../utils/permission-validator.js";
import { mergeConfigs } from "../utils/config-merger.js";
import type { IProjectContext } from "@openstarry/sdk";
import { createObservability } from "../observability.js";

export class StartCommand implements CliCommand {
  name = "start";
  description = "Start an agent from configuration";

  async execute(args: ParsedArgs): Promise<number> {
    // 1. Extract flags
    const configPath = args.flags.config as string | undefined;
    const verbose = args.flags.verbose as boolean;
    const noProjectDir = args.flags["no-project-dir"] as boolean | undefined;

    // [Plan34 W1] Project config detection
    let projectContext: IProjectContext | null = null;
    if (!noProjectDir) {
      projectContext = findProjectRoot();
      if (projectContext) {
        console.error(`[cli] Project config loaded: ${projectContext.dotOpenstarryPath}`);
        console.error(`[cli] WARNING: Project configuration may restrict Agent capabilities.`);
        console.error(`[cli] Use --no-project-dir to disable project configuration for this run.`);
      }
    }

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

    // [Plan34 W1] Project config merge (after loadConfig, before validateConfig)
    let projectPermissions: IProjectPermissions | null = null;
    if (projectContext) {
      try {
        const { projectConfig, projectPermissions: pp, projectPlugins } =
          await validateProjectConfig(projectContext);
        projectPermissions = pp;
        config = mergeConfigs(config, projectConfig, pp, projectPlugins, projectContext.projectRoot);
      } catch (err) {
        console.error(
          `[cli] Failed to load project config: ${err instanceof Error ? err.message : String(err)}`
        );
        return 1;
      }
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

    // [Plan34 W1] CWD default injection — only when no project restriction applied
    const projectRestrictedPaths = projectPermissions?.allowedPaths != null;
    if (
      (!validation.config!.capabilities.allowedPaths ||
        validation.config!.capabilities.allowedPaths.length === 0) &&
      !projectRestrictedPaths
    ) {
      validation.config!.capabilities.allowedPaths = [process.cwd()];
    }

    // 5. Create core
    const core = createAgentCore(validation.config!);

    // Plan48 wire-in (FIX-2026-06-11): opt-in observability — structured-log
    // via OPENSTARRY_LOG_PATH, audit-sink via OPENSTARRY_AUDIT=1. No-op when
    // env is unset. See ../observability.ts for the honest wiring status.
    const obs = createObservability();
    obs.log?.info("runner:started", {
      configPath: targetConfigPath,
      agent: validation.config!.identity?.name ?? null,
    });

    // 6. Load plugins
    const pluginResult = await resolvePlugins(
      validation.config!,
      verbose,
      projectContext?.projectRoot ?? null,
    );
    // Plan46 W1+W2: wrap each plugin so that PluginCapabilities.allowedTools
    // is enforced at runtime (W1) and PluginHooks.onCheckpoint/onRestore are
    // captured into a name-keyed map for the CheckpointManager (W2).
    // Both wrappers are runner-local — C46-1 Zero Core modifications.
    const hookMap = new Map<string, PluginHooks>();
    for (const plugin of pluginResult.plugins) {
      const filtered = wrapPluginWithToolFilter(plugin, (event) => {
        core.bus.emit({ type: event.type, timestamp: Date.now(), payload: event });
        // Plan48 wire-in (FIX-2026-06-11): journal denial to the audit-sink
        // (dedup + JSONL) when enabled — the producer the sink waited for.
        obs.publishCapabilityDenied({
          plugin: event.plugin,
          tool: event.tool,
          allowedTools: event.allowedTools,
          timestamp: event.timestamp,
        });
      });
      const captured = capturePluginHooks(filtered, hookMap);
      await core.loadPlugin(captured);
      obs.log?.info("plugin:loaded", { name: plugin.manifest.name, version: plugin.manifest.version });
    }
    // Plan47 C47-K3-M3 — wire CheckpointManager into daemon lifecycle.
    //   - On startup: if --checkpoint-path is set and the file exists, verify
    //     HMAC + nonce and restore plugin state (fresh-state fallback on error).
    //   - On graceful shutdown (SIGINT/SIGTERM/__QUIT__): write a signed
    //     checkpoint blob so the next daemon start can resume.
    //   - HMAC key + file path come from CLI flags / env; Core never sees them
    //     (MR-6 compliant — runner-local policy only).
    const checkpointMgr = createCheckpointManager(hookMap);
    const checkpointPath = this.resolveCheckpointPath(args);
    const hmacKey = this.resolveHmacKey(args);
    const nonceRegistry = new NonceRegistry();

    if (checkpointPath && hmacKey) {
      const readResult = await readSnapshotStore({
        path: checkpointPath,
        key: hmacKey,
        nonces: nonceRegistry,
      });
      if (readResult.ok) {
        checkpointMgr.restore(readResult.snapshots);
        console.error(
          `[cli] Restored ${readResult.snapshots.size} plugin snapshot(s) from ${checkpointPath}`,
        );
      } else if (!readResult.reason.startsWith('checkpoint file not found')) {
        // Missing file is a first-run condition; any other failure is fail-closed.
        console.error(`[cli] Checkpoint restore skipped: ${readResult.reason}`);
      }
    } else if (checkpointPath && !hmacKey) {
      console.error(
        '[cli] --checkpoint-path requires OPENSTARRY_CHECKPOINT_HMAC_KEY ' +
        '(or --checkpoint-hmac-key) to sign/verify the blob. Skipping checkpoint wire-in.',
      );
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

        // Plan47 C47-K3-M3 — persist checkpoint before core.stop() so plugin
        // state is captured while hooks are still valid (dispose() runs inside
        // core.stop() and clears internal state in some plugins).
        if (checkpointPath && hmacKey) {
          try {
            const snapshots = checkpointMgr.checkpoint();
            await writeSnapshotStore(snapshots, { path: checkpointPath, key: hmacKey });
            console.error(
              `[cli] Wrote ${snapshots.size} plugin snapshot(s) to ${checkpointPath}`,
            );
          } catch (err) {
            console.error(
              `[cli] Checkpoint write failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        await core.stop();

        // Plan48 wire-in (FIX-2026-06-11): flush observability buffers via the
        // shared registry (structured-log order 200 → audit-sink order 300).
        obs.log?.info("runner:shutdown", { signal });
        await obs.flush(signal === "SIGTERM" ? "SIGTERM" : signal === "SIGINT" ? "SIGINT" : "programmatic");

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

  /**
   * Plan47 C47-K3-M3 — resolve checkpoint path from CLI flag or env.
   * Runner-local policy; Core is untouched (MR-6 compliance).
   */
  private resolveCheckpointPath(args: ParsedArgs): string | null {
    const flag = args.flags["checkpoint-path"];
    if (typeof flag === "string" && flag.length > 0) {
      return resolve(flag);
    }
    const env = process.env["OPENSTARRY_CHECKPOINT_PATH"];
    if (env && env.length > 0) {
      return resolve(env);
    }
    return null;
  }

  /**
   * Plan47 C47-K3-M1/M5 — resolve HMAC key from CLI flag or env. Returned
   * as a string so {@link normalizeHmacKey} can pick hex vs utf-8. Keys never
   * enter Core; see {@link snapshot-hmac.ts} for the key contract.
   */
  private resolveHmacKey(args: ParsedArgs): string | null {
    const flag = args.flags["checkpoint-hmac-key"];
    if (typeof flag === "string" && flag.length > 0) return flag;
    const env = process.env["OPENSTARRY_CHECKPOINT_HMAC_KEY"];
    if (env && env.length > 0) return env;
    return null;
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
