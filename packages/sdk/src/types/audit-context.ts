/**
 * AuditContext — rich context provided to IConfidenceAuditor.
 *
 * Assembled by ManoAggregator before invoking audit().
 * Contains the sparsh event, gear evaluation, route result,
 * historical confidence window, and plugin-contributed extras.
 *
 * WIENER C-1: historicalConfidence contains ONLY raw arbiter confidence values.
 * WIENER C-2: No previousAuditResult is included.
 * WIENER C-3: extras keys with 'audit:' prefix are forbidden (enforced by isValidExtrasKey).
 *
 * @skandha vijnana (識蘊)
 * @see Plan31 Wave 1
 * @module audit-context
 */

import type { SparshEvent } from './coarising.js';
import type { GearEvaluation, RouteResult, RiskCategory } from './gear-arbiter.js';

export interface AuditContext {
  readonly version: 1;
  readonly sparshEvent: SparshEvent;
  readonly gearEvaluation: GearEvaluation;
  readonly riskCategory: RiskCategory | undefined;
  readonly routeResult: RouteResult;
  readonly historicalConfidence?: readonly number[];
  readonly extras: ReadonlyMap<string, unknown>;
}
