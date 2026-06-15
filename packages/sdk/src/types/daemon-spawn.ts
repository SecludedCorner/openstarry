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

/** Parameters for a runtime child spawn. */
export interface DaemonSpawnChildInput {
  /** Child agent id (unique within the process tree). */
  readonly agentId: string;
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

/**
 * Service exposed by the daemon so an in-loop tool can spawn a child agent.
 * Rejects (throws) on permission-lattice / path-traversal / drain denials —
 * the tool surfaces the denial to the model.
 */
export interface IDaemonSpawnService extends IPluginService {
  spawnChild(input: DaemonSpawnChildInput): Promise<DaemonSpawnChildResult>;
}
