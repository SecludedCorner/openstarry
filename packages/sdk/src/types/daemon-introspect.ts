/**
 * IDaemonIntrospectService — read-only process-tree introspection exposed to
 * in-loop tools.
 *
 * Doc 11 (Agent Manager) specced agent:list()/agent:status() so a running agent
 * could enumerate its child agents and read their live status — but the only
 * surfaces were the operator `ps` CLI and external IPC clients; the cognition
 * loop had no introspection tool. Under daemon mode the daemon registers an
 * implementation (backed by its processTree / childAgents RPC handlers) so the
 * `agent-introspect` plugin's tools can consume it via SERVICE_KEYS.DAEMON_INTROSPECT.
 * Outside daemon mode the service is absent and the tools report a daemon-only
 * message.
 *
 * Read-only by design: no spawn/kill here (that authorization model lives with
 * the spawn lattice). Layer: SDK type only — the impl lives in the runner daemon.
 *
 * NEW IN v0.59.7.
 */

import type { IPluginService } from "./service.js";

/** Summary of a single agent for in-loop introspection. */
export interface DaemonChildAgentInfo {
  readonly agentId: string;
  readonly pid: number;
  readonly status: string;
  readonly configPath: string;
  readonly uptime: number;
  readonly parentAgentId?: string;
  readonly childAgentIds: readonly string[];
  /** Human-friendly label (Spec Addendum A); undefined ⇒ use agentId. */
  readonly name?: string;
  /** Per-parent birth-order (Spec Addendum A); undefined ⇒ root agent. */
  readonly generation?: number;
}

/** A node in the agent process tree (max depth 3). */
export interface DaemonProcessTreeNode {
  readonly agentId: string;
  readonly pid: number;
  readonly status: string;
  readonly depth: number;
  readonly children: readonly DaemonProcessTreeNode[];
  /** Human-friendly label (Spec Addendum A); undefined ⇒ use agentId. */
  readonly name?: string;
  /** Per-parent birth-order (Spec Addendum A); undefined ⇒ root agent. */
  readonly generation?: number;
}

/**
 * Service exposed by the daemon for read-only process-tree introspection.
 */
export interface IDaemonIntrospectService extends IPluginService {
  /** Direct children of the given agent (empty if none / unknown). */
  listChildren(parentAgentId: string): Promise<DaemonChildAgentInfo[]>;
  /** The full process tree (roots → children, depth ≤ 3). */
  processTree(): Promise<DaemonProcessTreeNode[]>;
}
