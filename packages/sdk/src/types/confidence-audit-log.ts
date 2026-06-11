/**
 * ConfidenceAuditLog — structured audit log for confidence audit operations.
 *
 * Emitted via EventBus as `audit:completed` event after each audit cycle.
 * reasoning field truncated to 500 characters by Core (not by plugin).
 *
 * @skandha vijnana (識蘊)
 * @see Plan30 Wave 3, Doc 46 §5
 * @module confidence-audit-log
 */

import type { RiskCategory } from "./gear-arbiter.js";

/**
 * @deprecated Use {@link ConfidenceAuditEntry} (discriminated union) or {@link AuditTrailEntryV2} instead.
 * ConfidenceAuditLog is the Plan30 flat interface; Plan39 introduced the typed discriminated union.
 * This type will be removed in a future release.
 */
export interface ConfidenceAuditLog {
  /** Confidence value before audit delta was applied */
  readonly inputConfidence: number;
  /** Raw delta as returned by the auditor (before clamping) */
  readonly rawDelta: number;
  /** Clamped delta (±0.05 range) */
  readonly clampedDelta: number;
  /** Whether the raw delta was clamped */
  readonly wasClamped: boolean;
  /** Auditor reasoning (truncated to 500 chars by Core) */
  readonly reasoning: string;
  /** Confidence after delta application */
  readonly outputConfidence: number;
  /** Audit result status */
  readonly result: 'adjusted' | 'unchanged' | 'error';
  /** Audit duration in milliseconds */
  readonly auditDurationMs: number;
  /** Risk category of the evaluated action. Plan32 Wave 5 P0. */
  readonly riskCategory?: RiskCategory;
  /** Threshold value at the moment of routing decision. Plan32 Wave 5 P0. */
  readonly thresholdAtDecision?: number;
  /** Gear number at decision time. Plan32 Wave 5 P1. */
  readonly gearAtDecision?: number;
  /** Identifier of the decision-making arbiter. Plan32 Wave 5 P2. */
  readonly decidedBy?: string;
}

/** Maximum reasoning length before truncation by Core */
export const MAX_AUDIT_REASONING_LENGTH = 500;

/**
 * AuditTrailEntryBase — fields shared by all audit trail entry variants.
 *
 * FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * @since v0.39.0-alpha
 */
export interface AuditTrailEntryBase {
  readonly timestamp: number;
  readonly agentId: string;
  readonly sessionId?: string;
  readonly version: 1;
  // Hash chain fields (Plan36b)
  readonly prevHash?: string;
  readonly entryHash?: string;
}

/**
 * ConfidenceAuditEntry — confidence audit cycle result (audit:completed path).
 * Discriminant: type === 'confidence_audited'
 *
 * FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * @since v0.39.0-alpha
 */
export interface ConfidenceAuditEntry extends AuditTrailEntryBase {
  readonly type: 'confidence_audited';
  readonly inputConfidence: number;
  readonly rawDelta: number;
  readonly clampedDelta: number;
  readonly wasClamped: boolean;
  readonly reasoning: string;
  readonly outputConfidence: number;
  readonly result: 'adjusted' | 'unchanged' | 'error';
  readonly auditDurationMs: number;
  readonly riskCategory?: string;
  readonly thresholdAtDecision?: number;
  readonly gearAtDecision?: number;
  readonly decidedBy?: string;
}

/**
 * ToolAuditEntry — per-tool execution audit entry (audit:tool_audited path).
 * Discriminant: type === 'tool_audited'
 *
 * Plan39 W1: rawDelta is non-zero via B-modified delta injection.
 * CONSTRAINT-D2: fs.delete confidence = 0.85 (// WIENER R-1 annotation required).
 * CONSTRAINT-D3: fs.write confidence = 0.75.
 * CONSTRAINT-D6: fs.list classified as informational, delta = +0.001.
 *
 * FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * @since v0.39.0-alpha
 */
export interface ToolAuditEntry extends AuditTrailEntryBase {
  readonly type: 'tool_audited';
  readonly toolName: string;
  readonly inferredRiskCategory: RiskCategory;
  readonly executionResult: 'success' | 'error';
  /** Non-zero delta computed via B-modified path. CONSTRAINT-D2/D3/D6. */
  readonly rawDelta: number;
  readonly clampedDelta: number;
  readonly batchIndex: number;
  readonly batchSize: number;
  readonly routeRiskCategory?: string;
  /** Populated as 'tool_audited:{toolName}' per CONSTRAINT-D1 (F1/F2 stratification). */
  readonly decidedBy: string;
}

/**
 * SeedExchangeAuditEntry — seed exchange event audit entry.
 * Discriminant: type === 'seed_exchanged'
 * Added per D5-Q4 (R3, 3-0). Enables typed audit trail processing of AC-7 operations.
 *
 * FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * @since v0.39.0-alpha
 */
export interface SeedExchangeAuditEntry extends AuditTrailEntryBase {
  readonly type: 'seed_exchanged';
  readonly seedId: string;
  readonly fromAgentId: string;
  readonly toAgentIds: readonly string[];
  readonly seedsExchanged: number;
  readonly conflictsResolved: number;
}

/**
 * AuditTrailEntryV2 — discriminated union of all audit trail entry types.
 * Narrows via `entry.type` in TypeScript strict mode (AC-W0-3).
 *
 * FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * @since v0.39.0-alpha
 */
export type AuditTrailEntryV2 =
  | ConfidenceAuditEntry
  | ToolAuditEntry
  | SeedExchangeAuditEntry;
