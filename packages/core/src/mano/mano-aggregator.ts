/**
 * ManoAggregator — pure router for gear arbitration.
 *
 * Evaluates registered IGearArbiter instances in priority order.
 * First arbiter with confidence above the risk-weighted threshold wins.
 *
 * **N-Gear generalization**: GearAction is a number (1, 2, 3, ...),
 * not a fixed union. Core never assumes how many gears exist.
 *
 * **Microkernel purity**: Core only does chain traversal + timeout enforcement.
 * All policy (risk categorization, threshold values, gear count) comes from:
 * - Injected ManoAggregatorConfig (SDK-defined defaults, overridable)
 * - GearEvaluation.riskCategory (declared by plugin arbiters)
 *
 * G-1 path: if no arbiters are provided, defaults to config.defaultGear
 * (v0.26.0-beta compatible behavior when defaultGear=2).
 *
 * Plan31: AuditContext assembly, historicalConfidence buffer, extras collection,
 *         destructive delta ≤ 0 safety constraint.
 *
 * @skandha vijnana (識蘊)
 * @see Plan27: ManoAggregator Design
 * @see Plan31: AuditContext + ThresholdAuditor
 * @module mano-aggregator
 */

import type {
  EventBus,
  IGearArbiter,
  GearContext,
  GearEvaluation,
  RouteResult,
  ManoAggregatorConfig,
  ChannelVedana,
  VedanaEmergencyConfig,
  IConfidenceAuditor,
  SparshEvent,
  AuditContext,
} from "@openstarry/sdk";
import { DEFAULT_MANO_AGGREGATOR_CONFIG, DEFAULT_VEDANA_EMERGENCY_CONFIG, computeAdjustedThreshold } from "@openstarry/sdk";
import { createVedanaEmergencyState, checkVedanaEmergency } from "../vijnana/vedana-emergency.js";
import { clampAuditDelta } from "./confidence-audit.js";
import { DEFAULT_CONFIDENCE_AUDIT_CONFIG } from "@openstarry/sdk";
import type { ConfidenceAuditConfig } from "@openstarry/sdk";
import { MAX_AUDIT_REASONING_LENGTH } from "@openstarry/sdk";

export interface ManoAggregator {
  /** Route a context through the arbiter chain. Plan31: optional sparshEvent parameter. */
  route(context: GearContext, arbiters: IGearArbiter[], sparshEvent?: SparshEvent): Promise<RouteResult>;
  /** Force next route() to return this gear, bypassing arbiter chain (e.g., vitakka stall). */
  forceNextGear(gear: number): void;
}

export function createManoAggregator(
  bus: EventBus,
  config: ManoAggregatorConfig = DEFAULT_MANO_AGGREGATOR_CONFIG,
  baseThresholdFn?: () => number,
  vedanaFn?: () => ChannelVedana,
  vedanaEmergencyConfig: VedanaEmergencyConfig = DEFAULT_VEDANA_EMERGENCY_CONFIG,
  auditor?: IConfidenceAuditor,
  loopQualityFn?: () => number,  // Plan30 Wave 2: Layer 3 loop quality input
  confidenceAuditConfig: ConfidenceAuditConfig = DEFAULT_CONFIDENCE_AUDIT_CONFIG,
): ManoAggregator {
  let forcedGear: number | null = null;
  let vedanaEmergencyState = createVedanaEmergencyState();

  // Plan31 W1: historicalConfidence ring buffer (WIENER C-1: raw arbiter confidence only)
  const maxHistory = config.historicalConfidenceSize;
  const historicalBuffer: number[] = [];

  // Plan31 W1: extras collection via audit:context_contribute events
  const extrasMap = new Map<string, unknown>();
  bus.on('audit:context_contribute', (event) => {
    const p = event.payload as { key: string; value: unknown } | undefined;
    if (p && typeof p.key === 'string') {
      // WIENER C-3: reject keys with 'audit:' prefix (case-insensitive)
      if (!p.key.toLowerCase().startsWith('audit:')) {
        extrasMap.set(p.key, p.value);
      }
    }
  });

  return {
    async route(context: GearContext, arbiters: IGearArbiter[], sparshEvent?: SparshEvent): Promise<RouteResult> {
      // Clear extras at start of each route() call
      extrasMap.clear();

      // forceNextGear override (vitakka stall recovery)
      if (forcedGear !== null) {
        const gear = forcedGear;
        forcedGear = null;
        bus.emit({
          type: 'gear:switch',
          timestamp: Date.now(),
          payload: { gear, reason: 'vitakka_stall_override' },
        });
        return Promise.resolve({ gear, confidence: 1, riskAdjusted: false });
      }

      // G-1 path: no arbiters → default gear
      if (arbiters.length === 0) {
        return { gear: config.defaultGear, confidence: 0, riskAdjusted: false };
      }

      // VedanaEmergency: check sustained dukkha and compute threshold boost (Plan28 R1)
      let thresholdBoost = 0;
      if (vedanaFn) {
        const currentVedana = vedanaFn();
        const result = checkVedanaEmergency(currentVedana, vedanaEmergencyState, vedanaEmergencyConfig);
        thresholdBoost = result.thresholdBoost;
        vedanaEmergencyState = result.updatedState;
      }

      // Dynamic baseThreshold: prefer callback, fallback to static config, plus VedanaEmergency boost
      const effectiveBaseThreshold = (baseThresholdFn?.() ?? config.baseThreshold) + thresholdBoost;

      const chainDeadline = Date.now() + config.chainMs;

      for (const arbiter of arbiters) {
        // Check chain deadline
        if (Date.now() >= chainDeadline) {
          bus.emit({
            type: 'gear:switch',
            timestamp: Date.now(),
            payload: { reason: 'chain_timeout', gear: config.defaultGear },
          });
          return { gear: config.defaultGear, confidence: 0, riskAdjusted: false };
        }

        try {
          // Per-arbiter timeout
          const evaluationPromise = Promise.resolve(arbiter.evaluate(context));
          let arbiterTimer: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            arbiterTimer = setTimeout(
              () => reject(new Error(`Arbiter "${arbiter.id}" timed out`)),
              config.perArbiterMs,
            );
          });

          const evaluation: GearEvaluation = await Promise.race([
            evaluationPromise,
            timeoutPromise,
          ]);
          if (arbiterTimer !== undefined) clearTimeout(arbiterTimer);

          bus.emit({
            type: 'gear:arbiter_evaluated',
            timestamp: Date.now(),
            payload: {
              arbiterId: arbiter.id,
              action: evaluation.action,
              confidence: evaluation.confidence,
              riskCategory: evaluation.riskCategory,
              reasoning: evaluation.reasoning,
            },
          });

          // Skip abstains
          if (evaluation.action === 'abstain') continue;

          // Compute threshold: use arbiter-declared riskCategory if present,
          // otherwise use effective base threshold directly (no core-side inference)
          let threshold = evaluation.riskCategory
            ? computeAdjustedThreshold(effectiveBaseThreshold, evaluation.riskCategory, config.riskDelta, config.thresholdFloor, config.thresholdCeiling)
            : effectiveBaseThreshold;

          // Layer 3: Loop quality threshold adjustment (Plan30 Wave 2)
          if (loopQualityFn) {
            const alpha = config.loopQualityAlpha;
            const rawQ = loopQualityFn();
            const q = Math.max(0, Math.min(1, rawQ));  // Clamp to [0, 1]
            if (alpha > 0 && q > 0) {
              threshold = Math.max(
                config.thresholdFloor,
                threshold * (1 - alpha * q),
              );
            }
          }

          // Check confidence against threshold (strict >: threshold boundary rejects)
          if (evaluation.confidence > threshold) {
            const gear = evaluation.action;

            // Apply per-gear confidence cap from config
            const cap = config.maxConfidenceByGear[gear];
            const effectiveConfidence = cap != null
              ? Math.min(evaluation.confidence, cap)
              : evaluation.confidence;

            // WIENER C-1: push raw arbiter confidence BEFORE audit (pre-clamp)
            historicalBuffer.push(evaluation.confidence);
            if (historicalBuffer.length > maxHistory) historicalBuffer.shift();

            // Layer 2: Confidence audit (Plan29 + Plan30 + Plan31 AuditContext)
            let auditedConfidence = effectiveConfidence;
            if (auditor) {
              const auditTimeoutMs = config.auditTimeoutMs;
              const preliminaryResult: RouteResult = {
                gear,
                decidedBy: arbiter.id,
                confidence: effectiveConfidence,
                riskAdjusted: !!evaluation.riskCategory,
                riskCategory: evaluation.riskCategory,
              };

              // Plan31: Build AuditContext
              const auditContext: AuditContext = {
                version: 1,
                sparshEvent: sparshEvent ?? { root: 'unknown', object: null, consciousness: 'mano', timestamp: Date.now() },
                gearEvaluation: evaluation,
                riskCategory: evaluation.riskCategory,
                routeResult: preliminaryResult,
                historicalConfidence: Object.freeze([...historicalBuffer]),
                extras: new Map(extrasMap) as ReadonlyMap<string, unknown>,
              };

              const auditStart = Date.now();
              let timedOut = false;
              try {
                const auditPromise = Promise.resolve(auditor.audit(auditContext));
                let auditTimer: ReturnType<typeof setTimeout> | undefined;
                const auditTimeout = new Promise<never>((_, reject) => {
                  auditTimer = setTimeout(() => reject(new Error('Audit timeout')), auditTimeoutMs);
                });
                const auditResult = await Promise.race([auditPromise, auditTimeout]);
                if (auditTimer !== undefined) clearTimeout(auditTimer);
                const maxAuditDelta = confidenceAuditConfig.maxAuditDelta;
                let clampedDelta = clampAuditDelta(auditResult.delta, maxAuditDelta);

                // Plan31 D1-R1: destructive delta ≤ 0 safety constraint
                if (evaluation.riskCategory === 'destructive' && clampedDelta > 0) {
                  clampedDelta = 0;
                }

                auditedConfidence = effectiveConfidence + clampedDelta;
                // Emit audit:completed log (Plan30 SEC-030-02)
                const reasoning = typeof auditResult.reasoning === 'string'
                  ? auditResult.reasoning.slice(0, MAX_AUDIT_REASONING_LENGTH)
                  : '';
                bus.emit({
                  type: 'audit:completed',
                  timestamp: Date.now(),
                  payload: {
                    inputConfidence: effectiveConfidence,
                    rawDelta: auditResult.delta,
                    clampedDelta,
                    wasClamped: Math.abs(auditResult.delta) > maxAuditDelta,
                    reasoning,
                    outputConfidence: auditedConfidence,
                    result: clampedDelta !== 0 ? 'adjusted' : 'unchanged',
                    auditDurationMs: Date.now() - auditStart,
                    // Plan32 Wave 5: additional audit context fields
                    riskCategory: evaluation.riskCategory,
                    thresholdAtDecision: threshold,
                    gearAtDecision: gear,
                    decidedBy: arbiter.id,
                  },
                });
              } catch {
                // Fail-safe: audit error/timeout → delta=0 (D5-R5)
                timedOut = true;
                auditedConfidence = effectiveConfidence;
                bus.emit({
                  type: 'audit:completed',
                  timestamp: Date.now(),
                  payload: {
                    inputConfidence: effectiveConfidence,
                    rawDelta: 0,
                    clampedDelta: 0,
                    wasClamped: false,
                    reasoning: timedOut ? 'audit timeout: fail-safe delta=0' : 'audit error: fail-safe delta=0',
                    outputConfidence: effectiveConfidence,
                    result: 'error' as const,
                    auditDurationMs: Date.now() - auditStart,
                    riskCategory: evaluation.riskCategory,
                    thresholdAtDecision: threshold,
                    gearAtDecision: gear,
                    decidedBy: arbiter.id,
                  },
                });
              }
            }

            bus.emit({
              type: 'gear:switch',
              timestamp: Date.now(),
              payload: {
                gear,
                decidedBy: arbiter.id,
                confidence: auditedConfidence,
              },
            });

            return {
              gear,
              decidedBy: arbiter.id,
              confidence: auditedConfidence,
              riskAdjusted: !!evaluation.riskCategory,
              riskCategory: evaluation.riskCategory,
            };
          }
        } catch {
          // Arbiter timeout or error — skip and continue chain
          continue;
        }
      }

      // No arbiter met threshold → default gear
      bus.emit({
        type: 'gear:switch',
        timestamp: Date.now(),
        payload: { gear: config.defaultGear, confidence: 0 },
      });
      return { gear: config.defaultGear, confidence: 0, riskAdjusted: false };
    },

    forceNextGear(gear: number): void {
      forcedGear = gear;
    },
  };
}
