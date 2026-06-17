/**
 * Ps Command — List running agents.
 *
 * Command: openstarry ps [--verbose] [--tree]
 *
 * --tree (Doc 13 Process Tree): for every running daemon, query its
 * `agent.processTree` RPC and render the parent→child agent hierarchy with
 * indentation. Read-only — uses the existing RPC; no daemon-side change.
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import type { CliCommand, ParsedArgs } from "./base.js";
import { OPENSTARRY_HOME } from "../bootstrap.js";
import { pidManager } from "../daemon/pid-manager.js";
import { IPCClientImpl } from "../daemon/ipc-client.js";
import type { AgentStatus, ProcessTreeNode } from "../daemon/types.js";

/**
 * Minimal node shape used for rendering the process tree. Decouples the
 * renderer from the full AgentRegistryEntry so an IPC-failure fallback node
 * (only agentId/pid/status known) can be rendered the same way.
 */
export interface RenderTreeNode {
  agentId: string;
  pid: number;
  status: string;
  children: RenderTreeNode[];
}

/** Map daemon-internal ProcessTreeNode[] (RPC payload) to RenderTreeNode[]. */
export function toRenderTreeNodes(nodes: ProcessTreeNode[]): RenderTreeNode[] {
  return nodes.map((n) => ({
    agentId: n.entry.agentId,
    pid: n.entry.pid,
    status: n.entry.status,
    children: toRenderTreeNodes(n.children ?? []),
  }));
}

/**
 * Collect the agentIds of every node that appears as a CHILD (depth > 0) in
 * the given forest. Used to fold a child daemon's self-reported root under its
 * parent so it is not also rendered as a standalone root (each spawned child
 * is its own daemon process and would otherwise appear twice).
 */
export function collectChildIds(roots: RenderTreeNode[]): Set<string> {
  const childIds = new Set<string>();
  const walk = (node: RenderTreeNode, depth: number): void => {
    if (depth > 0) childIds.add(node.agentId);
    for (const c of node.children) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return childIds;
}

/**
 * Render a process-tree forest into indented lines (2 spaces per depth level).
 * Pure — depth is the recursion level, mirroring the daemon's depth field.
 */
export function renderProcessTreeLines(roots: RenderTreeNode[]): string[] {
  const lines: string[] = [];
  const render = (node: RenderTreeNode, depth: number): void => {
    const indent = "  ".repeat(depth);
    lines.push(`${indent}${node.agentId} (pid ${node.pid}) [${node.status}] depth=${depth}`);
    for (const c of node.children) render(c, depth + 1);
  };
  for (const r of roots) render(r, 0);
  return lines;
}

export class PsCommand implements CliCommand {
  name = "ps";
  description = "List running agents";

  async execute(args: ParsedArgs): Promise<number> {
    const verbose = args.flags.verbose as boolean;
    const tree = args.flags.tree as boolean;

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

    // --tree: render the cross-daemon process hierarchy (Doc 13).
    if (tree) {
      return this.printTree(runningAgents);
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

  /**
   * Query each running daemon's process tree and render the merged forest.
   * A child daemon also appears in listRunningAgents (it is a separate process)
   * and self-reports as a root in its own registry; collectChildIds folds those
   * under their parent so each agent is printed once.
   */
  async printTree(
    runningAgents: Array<{ agentId: string; pid: number; pidFile: string }>
  ): Promise<number> {
    const allRoots: RenderTreeNode[] = [];

    for (const agent of runningAgents) {
      const socketPath = join(OPENSTARRY_HOME, "sockets", `${agent.agentId}.sock`);
      const nodes = await this.tryGetProcessTree(socketPath, agent.agentId, agent.pid);
      allRoots.push(...nodes);
    }

    const childIds = collectChildIds(allRoots);
    const seen = new Set<string>();
    const roots = allRoots.filter((n) => {
      if (childIds.has(n.agentId)) return false;
      if (seen.has(n.agentId)) return false;
      seen.add(n.agentId);
      return true;
    });

    console.log("PROCESS TREE");
    const lines = renderProcessTreeLines(roots);
    for (const line of lines) {
      console.log(line);
    }

    console.log("");
    console.log(`${runningAgents.length} daemon(s) queried`);

    return 0;
  }

  /**
   * Query a single daemon's agent.processTree RPC. On IPC failure, fall back to
   * a flat single-node tree (status 'unknown') so the agent still appears.
   */
  private async tryGetProcessTree(
    socketPath: string,
    agentId: string,
    pid: number
  ): Promise<RenderTreeNode[]> {
    try {
      const client = new IPCClientImpl({ socketPath, timeoutMs: 3000 });
      await client.connect();
      const tree = (await client.call("agent.processTree")) as ProcessTreeNode[];
      client.close();
      return toRenderTreeNodes(tree ?? []);
    } catch {
      // IPC failed — show the agent flat so the tree view never hides a daemon.
      return [{ agentId, pid, status: "unknown", children: [] }];
    }
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
