/**
 * IVolition (思/Cetana) — two-phase deliberation types.
 *
 * Position B in ExecutionLoop: after LLM response, before tool execution.
 * Phase 1: Plan-level deliberation (deliberatePlan)
 * Phase 2: Per-action deliberation (deliberateAction)
 *
 * @skandha vijnana (識蘊)
 * @see R3 Debate 4: IVolition Two-Phase Deliberation (Doc 38)
 * @module volition
 */

import type { IVijnana } from "./aggregates.js";
import type { KleshaSignalBundle } from "./klesha.js";
import type { VedanaAssessment } from "./vedana.js";
import type { RouteResult, ActionRecord } from "./gear-arbiter.js";

/**
 * DeliberationContext — routing context from ManoAggregator for IVolition v1.
 * Provides the route decision and action history to enable risk-aware deliberation.
 *
 * @see Plan28: IVolition v1 + Safety Hardening
 */
export interface DeliberationContext {
  readonly routeResult: RouteResult;
  readonly actionHistory: readonly ActionRecord[];
}

/**
 * Lightweight tool call descriptor for deliberation input.
 * Avoids coupling to internal ToolCallRequest type.
 */
export interface ToolCallInfo {
  /** Tool name */
  readonly name: string;
  /** Tool arguments */
  readonly arguments: Record<string, unknown>;
}

/**
 * PlanDeliberationInput — input to Phase 1 (plan-level) deliberation.
 */
export interface PlanDeliberationInput {
  /** All proposed tool calls from LLM response */
  readonly proposedActions: readonly ToolCallInfo[];
  /** Current klesha signal bundle */
  readonly kleshaSignals: KleshaSignalBundle;
  /** Current vedana assessment */
  readonly vedanaAssessment: VedanaAssessment;
  /** Session identifier */
  readonly sessionId?: string;
  /** Routing context from ManoAggregator (Plan28: IVolition v1) */
  readonly deliberationContext?: DeliberationContext;
}

/**
 * PlanDeliberationResult — output from Phase 1 deliberation.
 */
export interface PlanDeliberationResult {
  /** Modified plan (null = accept as-is, array = rewritten plan) */
  readonly modifiedPlan: readonly ToolCallInfo[] | null;
  /** Reasoning for the deliberation decision */
  readonly reasoning: string;
}

/**
 * ActionDeliberationInput — input to Phase 2 (per-action) deliberation.
 */
export interface ActionDeliberationInput {
  /** Single proposed tool call */
  readonly proposedAction: ToolCallInfo;
  /** Current klesha signal bundle */
  readonly kleshaSignals: KleshaSignalBundle;
  /** Current vedana assessment */
  readonly vedanaAssessment: VedanaAssessment;
  /** Context from Phase 1 plan deliberation */
  readonly planContext: PlanDeliberationResult;
  /** Routing context from ManoAggregator (Plan28: IVolition v1) */
  readonly deliberationContext?: DeliberationContext;
}

/**
 * ActionDeliberationResult — output from Phase 2 deliberation.
 */
export interface ActionDeliberationResult {
  /** Whether to veto (reject) this action */
  readonly veto: boolean;
  /** Alternative action if vetoing (null = just skip) */
  readonly alternative: ToolCallInfo | null;
  /** Reasoning for the deliberation decision */
  readonly reasoning: string;
}

/**
 * IVolition — two-phase deliberation interface.
 *
 * Extends IVijnana (識蘊) since volition is a function of consciousness.
 * Operates in vijnana-clock domain (1-5ms budget).
 *
 * FC-28 ExtensionPoint: IKlesha is independent from IIdentity.
 * Causal chain (ego→klesha→action) deferred to cycle02-4.
 */
export interface IVolition extends IVijnana {
  /**
   * Phase 1: Plan-level deliberation (1-3ms, vijnana-clock).
   * Reviews all proposed actions as a batch. Can rewrite the plan.
   */
  deliberatePlan(input: PlanDeliberationInput): Promise<PlanDeliberationResult>;

  /**
   * Phase 2: Per-action deliberation (0.5-1ms each, vijnana-clock).
   * Reviews each action individually. Can veto or suggest alternatives.
   */
  deliberateAction(input: ActionDeliberationInput): Promise<ActionDeliberationResult>;
}
