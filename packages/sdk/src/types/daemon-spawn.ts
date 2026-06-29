/**
 * IDaemonSpawnService — runtime spawn capability exposed to in-loop tools.
 *
 * Ledger #10 (2026-06-15): until now, child-process spawning was either
 * config-time (composite agent config) or driven by an EXTERNAL daemon RPC
 * client. There was no surface for the running agent's own cognition loop to
 * decide to spawn a child — i.e. no LLM-invokable spawn tool.
 *
 * Under daemon mode, the daemon registers an implementation of this service
 * (backed by its spawnChild RPC handler, which enforces the F-5 permission
 * lattice + SEC-003 path traversal). The `agent-spawn` plugin's `agent.spawnChild`
 * ITool consumes it via SERVICE_KEYS.DAEMON_SPAWN. Outside daemon mode the
 * service is absent and the tool reports a clear "daemon-only" error.
 *
 * Layer: SDK type only — the implementation lives in the runner's daemon;
 * Core never spawns processes (MR-6 / Tenet #7 preserved).
 */

import type { IPluginService } from "./service.js";
import type { SupervisorStrategy } from "./agent.js";

/** Parameters for a runtime child spawn. */
export interface DaemonSpawnChildInput {
  /**
   * Child agent id (unique within the process tree).
   * Spec Addendum A (Fractal Society, 2026-06-26): OPTIONAL — when omitted the
   * daemon auto-generates a unique `<parentId>-<generation>` id; when supplied,
   * a collision is rejected fail-closed.
   */
  readonly agentId?: string;
  /** Optional human-friendly label (Spec Addendum A); defaults to the agentId. */
  readonly name?: string;
  /** Path to the child's agent config file. */
  readonly configPath: string;
  /** Optional daemon state dir; the daemon supplies its own default when omitted. */
  readonly statePath?: string;
}

/** Result of a successful runtime child spawn. */
export interface DaemonSpawnChildResult {
  readonly pid: number;
  readonly agentId: string;
}

/** Result of enabling supervision (restart-on-crash) for a child. */
export interface DaemonSuperviseResult {
  readonly supervised: boolean;
  readonly agentId: string;
  readonly strategy: SupervisorStrategy;
}

/**
 * Parameters for forking a child from the parent's CURRENT state (Spec Addendum B).
 * Same spawn fields as DaemonSpawnChildInput + the parent session to snapshot.
 */
export interface DaemonForkInput {
  /** Parent session id whose snapshot seeds the child's initial session. */
  readonly parentSessionId: string;
  readonly agentId?: string;
  readonly name?: string;
  readonly configPath: string;
  readonly statePath?: string;
}

/** Result of a fork (child spawned + parent session snapshot injected). */
export interface DaemonForkResult {
  readonly childAgentId: string;
  readonly pid: number;
  /** `<parentId>:<parentSessionId>` — shared by siblings branched off one snapshot. */
  readonly forkOrigin: string;
  readonly sessionId: string;
  /** Number of messages carried over from the parent snapshot. */
  readonly messageCount: number;
}

/** Parameters for branching N children off the SAME parent snapshot (Spec Addendum B). */
export interface DaemonBranchInput {
  readonly parentSessionId: string;
  readonly children: ReadonlyArray<{
    readonly agentId?: string;
    readonly name?: string;
    readonly configPath: string;
    readonly statePath?: string;
  }>;
}

/**
 * Service exposed by the daemon so an in-loop tool can spawn a child agent and
 * supervise it. Rejects (throws) on permission-lattice / path-traversal / drain
 * denials — the tool surfaces the denial to the model.
 */
export interface IDaemonSpawnService extends IPluginService {
  spawnChild(input: DaemonSpawnChildInput): Promise<DaemonSpawnChildResult>;
  /**
   * Enable restart-on-crash supervision for a child this agent spawned. When the
   * child's process is detected dead while still 'running' (crashed, not
   * gracefully stopped), the daemon restarts a set chosen by `strategy`
   * (one-for-one default), up to `maxRestarts`.
   */
  supervise(
    agentId: string,
    strategy?: SupervisorStrategy,
    maxRestarts?: number,
  ): Promise<DaemonSuperviseResult>;
  /**
   * Fork a child from the parent's current state (Spec Addendum B): spawn a child
   * (capabilities still child ⊆ parent — the lattice is NOT bypassed) and inject
   * the parent's session snapshot as the child's initial session. Memory/alaya
   * are NOT inherited (ratified default).
   */
  fork(input: DaemonForkInput): Promise<DaemonForkResult>;
  /** Branch: fork N children off the SAME parent snapshot (shared forkOrigin). */
  branch(input: DaemonBranchInput): Promise<readonly DaemonForkResult[]>;
}
