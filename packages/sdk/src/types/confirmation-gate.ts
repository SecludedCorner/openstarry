/**
 * IConfirmationGate — pre-execution confirmation for tool calls.
 *
 * Intercepts tool execution in the ExecutionLoop. For each tool call,
 * the gate decides whether to proceed, reject, or request user confirmation.
 *
 * @skandha samskara (行蘊 — action gating, cetana-driven)
 * @criticality optional-no-effect
 * @see Plan36b: T3 Confirmation Gate
 */

import type { ISamskara } from "./aggregates.js";
import type { RiskCategory } from "./gear-arbiter.js";

/**
 * ConfirmationRequest — the data presented to the gate for evaluation.
 */
export interface ConfirmationRequest {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly toolArguments: Record<string, unknown>;
  readonly riskCategory?: RiskCategory;
  readonly gear?: number;
  readonly sessionId?: string;
}

/**
 * ConfirmationDecision — the gate's response.
 */
export type ConfirmationDecision =
  | { readonly action: 'approve'; readonly reasoning?: string }
  | { readonly action: 'deny'; readonly reasoning: string }
  | { readonly action: 'ask_user'; readonly prompt: string; readonly timeoutMs?: number };

/**
 * UserConfirmationResponse — the result after asking the user.
 */
export interface UserConfirmationResponse {
  readonly approved: boolean;
  readonly reasoning?: string;
}

/**
 * IConfirmationGate — the gate interface.
 *
 * Single slot (last-wins) registered via PluginHooks.confirmationGate.
 * Core calls evaluate() before each tool execution.
 */
export interface IConfirmationGate extends ISamskara {
  readonly id: string;
  evaluate(request: ConfirmationRequest): ConfirmationDecision | Promise<ConfirmationDecision>;
}

/**
 * Default confirmation gate configuration.
 * All policy values — injected via plugin config, never hardcoded in Core.
 */
export interface ConfirmationGateConfig {
  readonly userPromptTimeoutMs?: number;
  readonly timeoutAction?: 'deny';
  readonly bypassCategories?: readonly RiskCategory[];
  readonly bypassGears?: readonly number[];
  readonly alwaysConfirmTools?: readonly string[];
  readonly neverConfirmTools?: readonly string[];
}

export const DEFAULT_CONFIRMATION_GATE_CONFIG: Required<ConfirmationGateConfig> = {
  userPromptTimeoutMs: 30000,
  timeoutAction: 'deny',
  bypassCategories: ['informational', 'read_only'],
  bypassGears: [1],
  alwaysConfirmTools: [],
  neverConfirmTools: [],
};
