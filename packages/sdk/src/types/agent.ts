/**
 * Agent configuration types.
 */

import type { ManoAggregatorConfig } from "./gear-arbiter.js";
import type { SafetyMonitorConfig } from "./safety.js";
import type { VitakkaWatchdogConfig, KleshaFilterConfig, KleshaModulationConfig } from "./klesha.js";
import type { VedanaEmergencyConfig, VedanaClassificationConfig } from "./vedana.js";
import type { ExecutionConfig } from "./execution.js";
import type { SandboxManagerConfig } from "./sandbox-defaults.js";

/** Agent identity metadata. */
export interface AgentIdentity {
  id: string;
  name: string;
  description?: string;
  version?: string;
}

/** Cognition configuration — how the agent thinks. */
export interface CognitionConfig {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxToolRounds?: number;
}

/** Capabilities configuration — what the agent can do. */
export interface CapabilitiesConfig {
  tools: string[];
  allowedPaths?: string[];
}

/** Policy configuration — safety and security rules. */
export interface PolicyConfig {
  maxConcurrentTools?: number;
  toolTimeout?: number;
  /** LLM call timeout in ms (default: 120000 = 2 minutes). */
  llmTimeout?: number;
  pathRestrictions?: string[];
}

/** Memory configuration. */
export interface MemoryConfig {
  slidingWindowSize: number;
}

/** Session management configuration. */
export interface SessionConfig {
  /** Session persistence settings. */
  persistence?: {
    /** Enable session persistence to disk. */
    enabled?: boolean;
    /** Idle time-to-live in seconds. */
    idleTTL?: number;
    /** Maximum number of messages to store per session. */
    maxHistorySize?: number;
  };
  /** Number of messages to replay when attaching to existing session. */
  replayCount?: number;
}

/** Audit trail configuration for JSONL writer. Plan31 Wave 3. */
export interface AuditTrailConfig {
  readonly filePath: string;
  readonly maxSizeBytes?: number;    // default: 10_000_000 (10MB)
  readonly maxFiles?: number;        // default: 5
  readonly enabled?: boolean;        // default: true
}

/**
 * Communication configuration for an agent.
 * Co-located with other lifecycle/communication settings in IAgentConfig.
 *
 * FROZEN: Spec Addendum FINDING-5 (2026-03-24, Cycle 20260324_cycle03-1).
 */
export interface ICommConfig {
  canSendTo?: string[];
  canReceiveFrom?: string[];
  exposedTools?: string[];
  maxMessageSize?: number;
  eventSubscriptions?: string[];
  timeoutMs?: number;
  maxRetries?: number;

  /**
   * Graceful shutdown grace period in milliseconds.
   *
   * SDK default: DEFAULT_AGENT_GRACE_PERIOD_MS (30000).
   * Hard maximum (MECHANISM ceiling): MAX_AGENT_GRACE_PERIOD_MS (300000).
   * Zod validation: z.number().int().min(0).max(300000).optional()
   *
   * FROZEN: Spec Addendum FINDING-5 (2026-03-24, Cycle 20260324_cycle03-1).
   */
  gracePeriodMs?: number;
}

/**
 * Supervisor strategy for child agents (Plan37 D2-R8).
 * POLICY: configurable per parent agent.
 *
 * FROZEN: Spec Addendum (2026-03-24, Cycle 20260324_cycle03-1).
 */
export type SupervisorStrategy = 'one-for-one' | 'one-for-all' | 'rest-for-one';

/**
 * Permission lattice snapshot captured at spawn time.
 * Stored in AgentRegistryEntry so the daemon can validate child spawn requests
 * against parent's current permissions without a live IPC call.
 *
 * FROZEN: Spec Addendum (2026-03-24, Cycle 20260324_cycle03-1).
 */
export interface CompositeAgentPermissionLattice {
  allowedPaths: string[];
  maxTokenBudget: number;
  remainingBudget: number;
  cumulativeDeltaCeiling: number;
  remainingCeiling: number;
  canSendTo: string[];
  canReceiveFrom: string[];
  exposedTools: string[];
}

/**
 * Composite agent interface — extends the per-agent cognitive model with
 * parent/child relationship metadata (Plan37 D3-R3, Rule #38).
 *
 * FROZEN: Spec Addendum (2026-03-24, Cycle 20260324_cycle03-1).
 */
export interface ICompositeAgent {
  readonly agentId: string;
  readonly parentAgentId?: string;
  readonly childAgentIds: readonly string[];
  /** Mechanism ceiling: 3. */
  readonly maxDepth: 3;
  /** SDK default: 0.3 (POLICY). */
  readonly reserve_ratio: number;
  readonly permissionLattice: CompositeAgentPermissionLattice;
}

/** The top-level agent configuration loaded from agent.json. */
export interface IAgentConfig {
  identity: AgentIdentity;
  cognition: CognitionConfig;
  capabilities: CapabilitiesConfig;
  policy?: PolicyConfig;
  memory?: MemoryConfig;
  session?: SessionConfig;
  plugins: PluginRef[];
  guide?: string;
  auditTrail?: AuditTrailConfig;

  /** Plan37: Multi-agent communication configuration. */
  communication?: ICommConfig;

  // Plan32 Wave 3: Externalized config overrides
  /** Mano (gear routing) configuration override. */
  mano?: Partial<ManoAggregatorConfig>;
  /** Confidence audit configuration. */
  confidenceAudit?: {
    maxAuditDelta?: number;
  };
  /** Safety circuit breaker configuration override. */
  safety?: Partial<SafetyMonitorConfig>;
  /** Vitakka watchdog configuration override. */
  vitakka?: Partial<VitakkaWatchdogConfig>;
  /** Vedana emergency configuration override. */
  vedanaEmergency?: Partial<VedanaEmergencyConfig>;
  /**
   * Vedana classification thresholds override (Doc 36 §15). Per-agent dukkha/
   * sukha thresholds for deriving discrete feeling-type from valence. Validated
   * against the Doc 36 §13 hard safety bounds at start (fail-closed).
   */
  vedanaClassification?: Partial<VedanaClassificationConfig>;

  // Plan32 Wave 4 (P1): Execution and klesha filter config overrides
  /** Execution loop configuration override. */
  execution?: Partial<ExecutionConfig>;
  /** Klesha filter parameter overrides. */
  kleshaFilter?: Partial<KleshaFilterConfig>;

  /**
   * Klesha gain-scheduled threshold modulation (Doc 37) — TENET-2026-06-11.
   *
   * OPT-IN by presence: when this block exists (even `{}`), agent-core
   * constructs KleshaModulatedDispatcher and wires θ(t) into gear
   * arbitration via createManoAggregator's baseThresholdFn slot; when
   * absent, routing uses the static mano baseThreshold (pre-v0.59 behavior,
   * byte-for-byte).
   *
   * Resolution precedence: explicit fields here win; unset bounds inherit
   * the RESOLVED mano values (baseThreshold/thresholdFloor/thresholdCeiling)
   * so the two configs cannot silently diverge; weights default to
   * DEFAULT_KLESHA_MODULATION_CONFIG.
   *
   * Note: Sneha's documented floor (0.10) means an enabled-but-idle agent
   * runs at θ ≈ base − 0.015, not exactly base — attachment never reaches
   * zero by design (Doc 37). This is why the feature is opt-in.
   */
  kleshaModulation?: Partial<KleshaModulationConfig>;

  // Plan32 Wave 4 (P2): Sandbox configuration override
  /** Sandbox manager configuration override. */
  sandbox?: Partial<SandboxManagerConfig>;

  // Plan33 D-31-1: postRouteCheck v2 policy overrides (RES-D2-2)
  /** Max token budget per route check. Default: Infinity (disabled). */
  maxTokenBudget?: number;
  /** Confidence floor for route check flagging. Default: 0 (disabled). */
  confidenceFloor?: number;
}

/** A reference to a plugin to load. */
export interface PluginRef {
  name: string;
  path?: string;
  config?: Record<string, unknown>;
}

/**
 * Constraints validated by spawnChildAgent permission lattice (F-5).
 * Three dimensions: path subset, token budget, confidence ceiling.
 * All constraints are checked against parent's current state at spawn time.
 *
 * Invariant (MECHANISM, non-bypassable):
 *   child.allowedPaths ⊆ parent.allowedPaths
 *   child.maxTokenBudget <= parent.remainingTokenBudget
 *   child.maxConfidenceCeiling <= parent.currentConfidence
 *
 * FROZEN: Architecture_Spec Plan38, Cycle 20260328_cycle03-2.
 * @since v0.38.0-alpha
 */
export interface SpawnConstraints {
  /** Paths the child agent is allowed to access. Must be subset of parent's allowedPaths. */
  allowedPaths: string[];
  /** Maximum token budget for child. Must not exceed parent's remaining budget. */
  maxTokenBudget: number;
  /** Maximum confidence ceiling for child. Must not exceed parent's current confidence. */
  maxConfidenceCeiling: number;
}

/**
 * Runtime permission lattice validator interface.
 * Implemented in the Daemon spawnChildAgent handler.
 * Throws SpawnDeniedError on any constraint violation (fail-closed).
 *
 * FROZEN: Architecture_Spec Plan38, Cycle 20260328_cycle03-2.
 * @since v0.38.0-alpha
 */
export interface IPermissionLattice {
  /**
   * Validate spawn constraints against parent agent entry.
   * @throws SpawnDeniedError with reason code if any constraint is violated.
   */
  validateSpawn(
    parentId: string,
    parentLattice: CompositeAgentPermissionLattice,
    childConstraints: SpawnConstraints,
  ): void;

  /**
   * Propagate parent termination to all children (cascading termination).
   * Returns list of child agent IDs that were terminated.
   */
  cascadeTermination(parentId: string): Promise<string[]>;
}
