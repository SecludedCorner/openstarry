/**
 * Ps Command — List running agents.
 *
 * Command: openstarry ps [--verbose]
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import type { CliCommand, ParsedArgs } from "./base.js";
import { OPENSTARRY_HOME } from "../bootstrap.js";
import { pidManager } from "../daemon/pid-manager.js";
import { IPCClientImpl } from "../daemon/ipc-client.js";
import type { AgentStatus } from "../daemon/types.js";

export class PsCommand implements CliCommand {
  name = "ps";
  description = "List running agents";

  async execute(args: ParsedArgs): Promise<number> {
    const verbose = args.flags.verbose as boolean;

    // 1. List running agents from PID files
    const pidsDir = join(OPENSTARRY_HOME, "pids");

    if (!existsSync(pidsDir)) {
      console.log("No agents running.");
      return 0;
    }

    const runningAgents = pidManager.listRunningAgents(pidsDir);

    if (runningAgents.length === 0) {
      console.log("No agents running.");
      return 0;
    }

    // 2. Gather agent info (optionally query via IPC for detailed status)
    const agentInfos = await Promise.all(
      runningAgents.map(async (agent) => {
        const socketPath = join(OPENSTARRY_HOME, "sockets", `${agent.agentId}.sock`);
        const logFile = join(OPENSTARRY_HOME, "logs", `${agent.agentId}.log`);

        if (verbose) {
          // Try to get detailed status via IPC
          const status = await this.tryGetStatus(socketPath, agent.agentId, agent.pid, logFile);
          return status;
        } else {
          // Just return basic info
          return {
            agentId: agent.agentId,
            pid: agent.pid,
            status: "running" as const,
            uptime: 0,
            configPath: "",
            logFile,
            socketPath,
          };
        }
      })
    );

    // 3. Print output
    if (verbose) {
      this.printVerbose(agentInfos);
    } else {
      this.printDefault(agentInfos);
    }

    console.log("");
    console.log(`${agentInfos.length} agent(s) running`);

    return 0;
  }

  private async tryGetStatus(
    socketPath: string,
    agentId: string,
    pid: number,
    logFile: string
  ): Promise<AgentStatus> {
    try {
      const client = new IPCClientImpl({ socketPath, timeoutMs: 3000 });
      await client.connect();
      const status = (await client.call("agent.status")) as AgentStatus;
      client.close();
      return status;
    } catch {
      // IPC failed, return basic info
      return {
        agentId,
        pid,
        status: "unknown",
        uptime: 0,
        configPath: "",
        logFile,
        socketPath,
      };
    }
  }

  private printDefault(agents: AgentStatus[]): void {
    console.log("AGENT ID      PID     STATUS     UPTIME       LOG FILE");

    for (const agent of agents) {
      const uptimeStr = this.formatUptime(agent.uptime);
      console.log(
        `${agent.agentId.padEnd(13)} ${String(agent.pid).padEnd(7)} ${agent.status.padEnd(10)} ${uptimeStr.padEnd(12)} ${agent.logFile}`
      );
    }
  }

  private printVerbose(agents: AgentStatus[]): void {
    for (const agent of agents) {
      const uptimeStr = this.formatUptime(agent.uptime);

      console.log(`AGENT ID: ${agent.agentId}`);
      console.log(`  PID: ${agent.pid}`);
      console.log(`  Status: ${agent.status}`);
      console.log(`  Uptime: ${uptimeStr}`);

      if (agent.configPath) {
        console.log(`  Config: ${agent.configPath}`);
      }

      console.log(`  Log: ${agent.logFile}`);
      console.log(`  Socket: ${agent.socketPath}`);
      console.log("");
    }
  }

  private formatUptime(seconds: number): string {
    if (seconds === 0) {
      return "unknown";
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }
}
