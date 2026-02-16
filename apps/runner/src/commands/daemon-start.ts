/**
 * Daemon Start Command — Launch agent in background daemon mode.
 *
 * Command: openstarry daemon start --config <path>
 */

import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import type { IAgentConfig } from "@openstarry/sdk";
import type { CliCommand, ParsedArgs } from "./base.js";
import { OPENSTARRY_HOME } from "../bootstrap.js";
import { spawnDaemon } from "../daemon/launcher.js";
import { pidManager } from "../daemon/pid-manager.js";
import { IPCClientImpl } from "../daemon/ipc-client.js";
import { getDefaultSocketPath, waitForEndpoint } from "../daemon/platform.js";

export class DaemonStartCommand implements CliCommand {
  name = "daemon-start";
  description = "Start agent in background daemon mode";

  async execute(args: ParsedArgs): Promise<number> {
    // 1. Extract flags
    const configPath = args.flags.config as string | undefined;

    if (!configPath) {
      console.error("Error: --config <path> is required");
      console.error("Usage: openstarry daemon start --config <path>");
      return 1;
    }

    const resolvedConfigPath = resolve(configPath);

    if (!existsSync(resolvedConfigPath)) {
      console.error(`Error: Config file not found: ${resolvedConfigPath}`);
      return 1;
    }

    // 2. Load config to extract agent ID
    let config: IAgentConfig;
    try {
      const raw = await readFile(resolvedConfigPath, "utf-8");
      config = JSON.parse(raw) as IAgentConfig;
    } catch (err) {
      console.error(`Error: Failed to load config: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }

    const agentId = args.flags["agent-id"] as string | undefined ?? config.identity.id;

    // 3. Check if daemon already running
    const pidFile = join(OPENSTARRY_HOME, "pids", `${agentId}.pid`);
    const socketPath = getDefaultSocketPath(agentId, OPENSTARRY_HOME);

    const existingPid = pidManager.readPid(pidFile);
    if (existingPid !== null && pidManager.isProcessRunning(existingPid)) {
      console.error(`Error: Agent '${agentId}' is already running (PID: ${existingPid}).`);
      console.error(`Use 'openstarry daemon stop ${agentId}' to stop it first.`);
      return 1;
    }

    // 4. Cleanup stale files if any
    if (existingPid !== null) {
      console.error(`Cleaning up stale PID file for agent '${agentId}'...`);
      pidManager.cleanupStale(pidFile, socketPath);
    }

    // 5. Spawn daemon
    console.error(`Starting daemon for agent '${agentId}'...`);

    let result;
    try {
      result = await spawnDaemon({
        agentId,
        configPath: resolvedConfigPath,
        statePath: OPENSTARRY_HOME,
      });
    } catch (err) {
      console.error(`Error: Failed to spawn daemon: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }

    // 6. Wait for socket/pipe endpoint to be ready (max 5s)
    try {
      await waitForEndpoint(result.socketPath, 5000);
    } catch {
      console.error(`Error: Daemon socket not ready after 5 seconds`);
      console.error(`Check log file: ${result.logFile}`);
      return 1;
    }

    // 7. Try IPC ping to confirm daemon is responsive
    try {
      const client = new IPCClientImpl({ socketPath: result.socketPath, timeoutMs: 3000 });
      await client.connect();
      await client.call("agent.ping");
      client.close();
    } catch (err) {
      console.error(`Warning: Daemon started but not responsive to ping: ${err}`);
      console.error(`Check log file: ${result.logFile}`);
    }

    // 8. Success
    console.log("Daemon started successfully.");
    console.log(`  Agent ID: ${result.agentId}`);
    console.log(`  PID: ${result.pid}`);
    console.log(`  Log file: ${result.logFile}`);
    console.log(`  Socket: ${result.socketPath}`);
    console.log("");
    console.log(`Use 'openstarry daemon stop ${result.agentId}' to stop.`);

    return 0;
  }

}
