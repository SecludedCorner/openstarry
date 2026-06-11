/**
 * Re-export from SDK — risk threshold types and utilities.
 *
 * Core does NOT contain any policy logic. All risk category inference
 * and threshold computation is done by plugins (arbiters) or injected config.
 * This file exists only to maintain the barrel export from core/index.ts.
 *
 * @skandha vijnana (識蘊)
 * @see Plan27: Risk-Weighted Gear Threshold
 * @module klesha-threshold
 */

export type { RiskCategory, RiskDeltaConfig } from "@openstarry/sdk";
export { computeAdjustedThreshold, inferRiskCategory, DEFAULT_RISK_DELTA } from "@openstarry/sdk";
