/**
 * IGearArbiter — plugin-provided gear routing arbiter.
 *
 * Replaces core-embedded VasanaEngine with a plugin-driven approach.
 * Each arbiter evaluates whether the current context warrants a gear switch
 * (e.g., from Gear 2 "slow thinking" to Gear 1 "fast path").
 *
 * @skandha vijnana (識蘊)
 * @see Plan27: Gear Arbitration Architecture
 * @module gear-arbiter
 */

/**
 * AgentConfig — minimal agent configuration visible to gear arbiters.
 */
export interface AgentConfig {
  /** Agent identity ID */
  readonly id: string;
  /** Current model ID (if any) */
  readonly model?: string;
}

/**
 * GearToolCall — a tool call proposal within gear evaluation.
 */
export interface GearToolCall {
  /** Tool name */
  readonly name: string;
  /** Tool arguments */
  readonly arguments: Record<string, unknown>;
}

/**
 * ActionRecord — historical record of a past action.
 */
export interface ActionRecord {
  /** Tool/action name */
  readonly name: string;
  /** Whether the action succeeded */
  readonly success: boolean;
  /** Timestamp (epoch ms) */
  readonly timestamp: number;
}

/**
 * GearContext — the context provided to an arbiter for evaluation.
 */
export interface GearContext {
  /** Current user input text */
  readonly input: string;
  /** Proposed tool calls from LLM (if any) */
  readonly proposedToolCalls: readonly GearToolCall[];
  /** Recent action history */
  readonly actionHistory: readonly ActionRecord[];
  /** Agent configuration */
  readonly agentConfig: AgentConfig;
  /** Current session ID (if any) */
  readonly sessionId?: string;
}

/**
 * GearAction — what the arbiter recommends.
 *
 * N-Gear generalization: any positive integer gear number, or 'abstain'.
 * Lower gear number = faster/simpler path. Higher = deeper processing.
 *   Gear 1: fast path (skip LLM)
 *   Gear 2: standard LLM loop (v0.26 default)
 *   Gear 3+: reserved for future (e.g., deep reasoning, multi-agent)
 */
export type GearAction = number | 'abstain';

/**
 * Risk category for an action — declared by the arbiter (plugin-side).
 * Core uses this to adjust threshold via injected config, but never infers it.
 */
export type RiskCategory = 'destructive' | 'state_modifying' | 'read_only' | 'informational';

/**
 * GearEvaluation — result of an arbiter's evaluation.
 */
export interface GearEvaluation {
  /** Recommended gear action */
  readonly action: GearAction;
  /** Confidence in the recommendation: [0.0, 1.0] */
  readonly confidence: number;
  /** Risk category of the proposed action (plugin-declared, optional) */
  readonly riskCategory?: RiskCategory;
  /** Human-readable reasoning (for logging/debugging) */
  readonly reasoning?: string;
}

/**
 * RouteResult — the final routing decision from ManoAggregator.
 */
export interface RouteResult {
  /** Final gear decision (positive integer: 1=fast, 2=standard LLM, 3+=future) */
  readonly gear: number;
  /** Which arbiter made the decisive evaluation (if any) */
  readonly decidedBy?: string;
  /** Confidence of the decisive evaluation */
  readonly confidence: number;
  /** Whether risk-weighted threshold was applied */
  readonly riskAdjusted: boolean;
  /** Risk category of the decisive evaluation (Plan28: propagated from arbiter) */
  readonly riskCategory?: RiskCategory;
  /**
   * Post-route safety flags (optional).
   * NEW IN v0.33.0-alpha (Plan33 D-31-1).
   *
   * Added by postRouteCheck v2. Non-blocking — flags inform but never reject.
   */
  flags?: Record<string, boolean>;
}

/**
 * Risk delta configuration — maps RiskCategory to threshold adjustment.
 * Injected into ManoAggregator via config so core contains no policy values.
 */
export interface RiskDeltaConfig {
  readonly destructive: number;
  readonly state_modifying: number;
  readonly read_only: number;
  readonly informational: number;
}

/**
 * ManoAggregatorConfig — full configuration for gear arbitration.
 * All policy values are injected, core does no policy inference.
 */
export interface ManoAggregatorConfig {
  /** Per-arbiter evaluation timeout in ms (default: 100) */
  readonly perArbiterMs: number;
  /** Total chain deadline in ms (default: 200) */
  readonly chainMs: number;
  /**
   * Per-gear confidence caps (safety caps).
   * Key = gear number, value = max confidence.
   * Gears not listed have no cap (effective cap = 1.0).
   * Default: { 1: 0.95 }
   */
  readonly maxConfidenceByGear: Readonly<Record<number, number>>;
  /** Default gear when no arbiter meets threshold or chain is empty (default: 2) */
  readonly defaultGear: number;
  /** Base confidence threshold (default: 0.6) */
  readonly baseThreshold: number;
  /** Risk delta adjustments per category */
  readonly riskDelta: RiskDeltaConfig;
  /** Minimum allowed threshold after risk adjustment (default: 0.3) */
  readonly thresholdFloor: number;
  /** Maximum allowed threshold after risk adjustment (default: 0.9) */
  readonly thresholdCeiling: number;
  /** Confidence auditor timeout in ms (default: 200). Plan29. */
  readonly auditTimeoutMs: number;
  /**
   * Layer 3 loop quality alpha (α).
   * θ_adjusted = max(thresholdFloor, θ × (1 - α × q))
   * Default: 0.10. Set to 0 to disable Layer 3 effect.
   * @see Plan30 Wave 2
   */
  readonly loopQualityAlpha: number;
  /**
   * Maximum age (ms) for a monitor report to be considered fresh.
   * Default: 5000 (5 seconds).
   * @see Plan30 Wave 2
   */
  readonly monitorStalenessMs: number;
  /**
   * Size of the historical confidence window.
   * WIENER C-1: this window contains ONLY raw arbiter confidence values.
   * Default: 10.
   * @see Plan30 Wave 2
   */
  readonly historicalConfidenceSize: number;
}

/**
 * IGearArbiter — a plugin-provided gear routing arbiter.
 *
 * Arbiters are registered by plugins and evaluated in priority order
 * by the ManoAggregator. The first arbiter with confidence above the
 * risk-weighted threshold wins.
 */
export interface IGearArbiter {
  /** Unique arbiter identifier */
  readonly id: string;
  /** Priority (lower = evaluated first) */
  readonly priority: number;
  /** Evaluate the context and recommend a gear action */
  evaluate(context: GearContext): GearEvaluation | Promise<GearEvaluation>;
}

/**
 * Tool confidence table — base confidence values per risk category.
 * Used by the B-modified delta injection path (Plan39 W1).
 *
 * CONSTRAINT-D2: fs.delete = 0.85 // WIENER R-1
 * CONSTRAINT-D3: fs.write = 0.75
 * CONSTRAINT-D6: fs.list = informational, delta = +0.001
 */
export const TOOL_CONFIDENCE_TABLE: Readonly<Record<RiskCategory, number>> = {
  destructive: 0.85, // WIENER R-1
  state_modifying: 0.75,
  read_only: 0.50,
  informational: 0.001,
};

/**
 * Default risk delta configuration.
 */
export const DEFAULT_RISK_DELTA: RiskDeltaConfig = {
  destructive: 0.20,
  state_modifying: 0.10,
  read_only: 0.00,
  informational: -0.10,
};

/**
 * Default ManoAggregator configuration.
 * Exported from SDK so plugins/config can override any value.
 */
export const DEFAULT_MANO_AGGREGATOR_CONFIG: ManoAggregatorConfig = {
  perArbiterMs: 100,
  chainMs: 200,
  maxConfidenceByGear: { 1: 0.95 },
  defaultGear: 2,
  baseThreshold: 0.6,
  riskDelta: DEFAULT_RISK_DELTA,
  thresholdFloor: 0.3,
  thresholdCeiling: 0.9,
  auditTimeoutMs: 200,
  loopQualityAlpha: 0.10,
  monitorStalenessMs: 5000,
  historicalConfidenceSize: 10,
};

/**
 * Structural type guard for IGearArbiter.
 *
 * Checks: id (string), priority (number), evaluate (function with arity ≤ 1).
 */
export function isGearArbiter(value: unknown): value is IGearArbiter {
  if (value == null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.priority === 'number' &&
    typeof obj.evaluate === 'function' &&
    (obj.evaluate as Function).length <= 1
  );
}

/**
 * Compute risk-adjusted threshold from config + risk category.
 * Pure function — SDK utility, all values injected (no hardcoded policy).
 */
export function computeAdjustedThreshold(
  baseThreshold: number,
  riskCategory: RiskCategory,
  riskDelta: RiskDeltaConfig,
  thresholdFloor: number = 0.3,
  thresholdCeiling: number = 0.9,
): number {
  const adjusted = baseThreshold + riskDelta[riskCategory];
  return Math.max(thresholdFloor, Math.min(thresholdCeiling, adjusted));
}

/**
 * Infer risk category from a tool name using heuristic patterns.
 *
 * This is an SDK convenience utility for plugin authors.
 * Core never calls this — arbiters (plugins) use it if they choose to.
 */
export function inferRiskCategory(action: string): RiskCategory {
  const lower = action.toLowerCase();

  const destructive = ['delete', 'remove', 'drop', 'destroy', 'purge', 'kill'];
  const stateModifying = ['write', 'update', 'create', 'set', 'modify', 'patch', 'put', 'post'];
  // 'list' removed from readOnly — reclassified as informational per CONSTRAINT-D6 (Plan39 W1)
  const readOnly = ['read', 'get', 'search', 'find', 'query', 'fetch'];
  // 'list' is informational per CONSTRAINT-D6 (Plan39 W1, AC-W1-5)
  const informational = ['list'];

  for (const p of destructive) { if (lower.includes(p)) return 'destructive'; }
  for (const p of stateModifying) { if (lower.includes(p)) return 'state_modifying'; }
  for (const p of readOnly) { if (lower.includes(p)) return 'read_only'; }
  for (const p of informational) { if (lower.includes(p)) return 'informational'; }

  return 'informational';
}
