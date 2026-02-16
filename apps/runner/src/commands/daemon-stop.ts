/**
 * Daemon Stop Command — Stop a running daemon.
 *
 * Command: openstarry daemon stop <agent-id>
 */

import { join } from "node:path";
import type { CliCommand, ParsedArgs } from "./base.js";
import { OPENSTARRY_HOME } from "../bootstrap.js";
import { pidManager } from "../daemon/pid-manager.js";
import { IPCClientImpl } from "../daemon/ipc-client.js";
import { getDefaultSocketPath } from "../daemon/platform.js";

export class DaemonStopCommand implements CliCommand {
  name = "daemon-stop";
  description = "Stop a running daemon";

  async execute(args: ParsedArgs): Promise<number> {
    // 1. Extract agent ID from positional args or auto-detect
    let agentId = args.positional[0];

    if (!agentId) {
      const pidsDir = join(OPENSTARRY_HOME, "pids");
      const running = pidManager.listRunningAgents(pidsDir);
      if (running.length === 1) {
        agentId = running[0].agentId;
        console.error(`Auto-detected running agent: ${agentId}`);
      } else if (running.length > 1) {
        console.error("Error: Multiple agents running. Specify which one to stop:");
        for (const agent of running) {
          console.error(`  openstarry daemon stop ${agent.agentId}`);
        }
        return 1;
      } else {
        console.error("Error: No agents running.");
        return 1;
      }
    }

    // 2. Read PID file
    const pidFile = join(OPENSTARRY_HOME, "pids", `${agentId}.pid`);
    const socketPath = getDefaultSocketPath(agentId, OPENSTARRY_HOME);

    const pid = pidManager.readPid(pidFile);

    if (pid === null) {
      console.error(`Error: Agent '${agentId}' not found (no PID file)`);
      return 1;
    }

    // 3. Check if process is running
    if (!pidManager.isProcessRunning(pid)) {
      console.log(`Warning: Agent '${agentId}' is not running (stale PID file cleaned up).`);
      pidManager.cleanupStale(pidFile, socketPath);
      return 0;
    }

    // 4. Try graceful stop via IPC
    console.error(`Stopping daemon for agent '${agentId}' (PID: ${pid})...`);

    const ipcSuccess = await this.tryIPCStop(socketPath, pid);

    if (ipcSuccess) {
      console.log("Daemon stopped successfully.");
      console.log(`  Agent ID: ${agentId}`);
      console.log(`  PID: ${pid}`);
      return 0;
    }

    // 5. Fallback to SIGTERM
    console.error("IPC stop failed, sending SIGTERM...");
    try {
      process.kill(pid, "SIGTERM");
    } catch (err) {
      console.error(`Error: Failed to send SIGTERM: ${err}`);
      return 1;
    }

    // 6. Wait for process to exit (max 5s)
    const exitedGracefully = await this.waitForProcessExit(pid, 5000);

    if (exitedGracefully) {
      console.log("Daemon stopped successfully.");
      console.log(`  Agent ID: ${agentId}`);
      console.log(`  PID: ${pid}`);
      return 0;
    }

    // 7. Escalate to SIGKILL
    console.error("Process did not exit gracefully, sending SIGKILL...");
    try {
      process.kill(pid, "SIGKILL");
    } catch (err) {
      console.error(`Error: Failed to send SIGKILL: ${err}`);
      return 1;
    }

    // Wait a bit for SIGKILL to take effect
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (!pidManager.isProcessRunning(pid)) {
      console.log("Daemon forcefully killed.");
      console.log(`  Agent ID: ${agentId}`);
      console.log(`  PID: ${pid}`);
      return 0;
    }

    console.error("Error: Failed to stop daemon");
    return 1;
  }

  private async tryIPCStop(socketPath: string, pid: number): Promise<boolean> {
    try {
      const client = new IPCClientImpl({ socketPath, timeoutMs: 10000 });
      await client.connect();
      await client.call("agent.stop");
      client.close();

      // Wait for process to exit (max 10s)
      return await this.waitForProcessExit(pid, 10000);
    } catch {
      return false;
    }
  }

  private async waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (!pidManager.isProcessRunning(pid)) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return false;
  }
}
