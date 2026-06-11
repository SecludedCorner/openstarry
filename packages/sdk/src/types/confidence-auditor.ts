/**
 * IConfidenceAuditor — confidence audit types.
 *
 * Model Delta Layer 2 (Delta_audit) infrastructure.
 * Auditors adjust arbiter confidence after the arbiter chain resolves,
 * before the final routing decision is returned.
 *
 * @skandha vijnana (識蘊)
 * @see Plan29: IConfidenceAuditor + Model Delta Layer 2
 * @module confidence-auditor
 */

import type { IVijnana } from "./aggregates.js";
import type { RouteResult } from "./gear-arbiter.js";
import type { AuditContext } from "./audit-context.js";

/**
 * ConfidenceAuditResult — the outcome of an audit.
 */
export interface ConfidenceAuditResult {
  /** Confidence delta to apply (clamped to ±0.05 by core) */
  readonly delta: number;
  /** Reasoning for the audit adjustment */
  readonly reasoning: string;
}

/**
 * IConfidenceAuditor — a plugin-provided confidence auditor.
 *
 * Extends IVijnana (識蘊) — operates in the consciousness layer (D5-R9).
 * Singular last-wins slot in PluginHooks (D5-R1/R4).
 *
 * audit() is called after an arbiter wins with confidence above threshold.
 * The returned delta is clamped to ±MAX_AUDIT_DELTA and added to confidence.
 */
export interface IConfidenceAuditor extends IVijnana {
  /** Unique auditor identifier */
  readonly id: string;
  /** Audit a routing decision and return a confidence adjustment.
   *  Plan31: accepts AuditContext (rich context) or RouteResult (backward compat). */
  audit(context: AuditContext | RouteResult): ConfidenceAuditResult | Promise<ConfidenceAuditResult>;
}

/**
 * Confidence audit configuration.
 * Plan32 Wave 3: Externalized from Core to SDK.
 */
export interface ConfidenceAuditConfig {
  /** Maximum absolute audit delta (±maxAuditDelta). */
  readonly maxAuditDelta: number;
}

/** SDK default confidence audit configuration. */
export const DEFAULT_CONFIDENCE_AUDIT_CONFIG: ConfidenceAuditConfig = {
  maxAuditDelta: 0.05,
};
