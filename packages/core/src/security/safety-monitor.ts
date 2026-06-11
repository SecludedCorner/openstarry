/**
 * SafetyMonitor — safety guardrails for the execution loop.
 * @skandha vedana (受蘊 — 三受反饋·苦樂捨 placeholder, full implementation in Plan26)
 *
 * Level 1: Resource limits (token budget, loop cap)
 * Level 2: Behavioral analysis (repetitive tool calls, error cascade)
 * Level 3: Frustration counter (consecutive failures → ask user for help)
 *
 * Per design doc: 07_Safety_Circuit_Breakers.md & 12_Error_Handling_and_Self_Correction.md
 */

import { createHash } from "node:crypto";
import { createLogger } from "@openstarry/shared";
import type { RouteResult } from "@openstarry/sdk";
import { DEFAULT_POST_ROUTE_MAX_TOKEN_BUDGET, DEFAULT_POST_ROUTE_CONFIDENCE_FLOOR } from "@openstarry/sdk";

const logger = createLogger("SafetyMonitor");

export interface SafetyCheckResult {
  halt: boolean;
  reason?: string;
  injectPrompt?: string;
}

import type { SafetyMonitorConfig } from "@openstarry/sdk";

export interface SafetyMonitor {
  /** Called when a new input event starts processing. Resets per-task counters. */
  onLoopStart(): void;
  /** Called each loop tick. Checks loop cap. */
  onLoopTick(): SafetyCheckResult;
  /** Called before each LLM call. Checks token budget. */
  beforeLLMCall(): SafetyCheckResult;
  /** Called after each tool execution. Checks behavioral patterns. */
  afterToolExecution(
    toolName: string,
    argsJson: string,
    isError: boolean,
  ): SafetyCheckResult;
  /** Track token usage from provider response. */
  trackTokenUsage(tokens: number): void;
  /** Reset all counters (e.g., on /reset). */
  reset(): void;
  /**
   * Post-route safety check on RouteResult (Plan28).
   * v1: passthrough. Plugins can wrap/replace for policy enforcement.
   * Named postRouteCheck (not postCheck) to avoid Doc 44 postLLMCheck conflict.
   */
  postRouteCheck(routeResult: RouteResult): RouteResult;
}

/** Post-route check policy options (Plan33 D-31-1). */
export interface PostRouteCheckOptions {
  maxTokenBudget?: number;
  confidenceFloor?: number;
}

export function createSafetyMonitor(
  config: SafetyMonitorConfig,
  postRouteOptions?: PostRouteCheckOptions,
): SafetyMonitor {
  const maxTokenBudget = postRouteOptions?.maxTokenBudget ?? DEFAULT_POST_ROUTE_MAX_TOKEN_BUDGET;
  const confidenceFloor = postRouteOptions?.confidenceFloor ?? DEFAULT_POST_ROUTE_CONFIDENCE_FLOOR;

  let tickCount = 0;
  let totalTokensUsed = 0;
  let consecutiveFailures = 0;

  // For repetitive tool call detection: fingerprint history
  const recentFingerprints: Array<{ fingerprint: string; isError: boolean }> =
    [];

  // For error rate calculation: sliding window of success/failure
  const errorWindow: boolean[] = [];

  function fingerprint(toolName: string, argsJson: string): string {
    return createHash("sha256")
      .update(`${toolName}:${argsJson}`)
      .digest("hex")
      .slice(0, config.fingerprintLength);
  }

  return {
    onLoopStart(): void {
      tickCount = 0;
    },

    onLoopTick(): SafetyCheckResult {
      tickCount++;
      if (config.maxLoopTicks > 0 && tickCount > config.maxLoopTicks) {
        const reason = `SAFETY: Loop tick limit exceeded (${config.maxLoopTicks}). Task may be stuck in an infinite loop.`;
        logger.warn(reason);
        return { halt: true, reason };
      }
      return { halt: false };
    },

    beforeLLMCall(): SafetyCheckResult {
      if (
        config.maxTokenUsage > 0 &&
        totalTokensUsed >= config.maxTokenUsage
      ) {
        const reason = `SAFETY: Token budget exhausted (${totalTokensUsed}/${config.maxTokenUsage}). Halting to prevent cost overrun.`;
        logger.warn(reason);
        return { halt: true, reason };
      }
      return { halt: false };
    },

    afterToolExecution(
      toolName: string,
      argsJson: string,
      isError: boolean,
    ): SafetyCheckResult {
      const fp = fingerprint(toolName, argsJson);

      // Track in error window
      errorWindow.push(isError);
      if (errorWindow.length > config.errorWindowSize) {
        errorWindow.shift();
      }

      if (isError) {
        consecutiveFailures++;

        // Check repetitive failed tool calls
        recentFingerprints.push({ fingerprint: fp, isError: true });
        if (recentFingerprints.length > config.repetitiveFailThreshold) {
          recentFingerprints.shift();
        }

        // All recent fingerprints identical and all failed?
        if (recentFingerprints.length >= config.repetitiveFailThreshold) {
          const allSame = recentFingerprints.every(
            (r) => r.fingerprint === fp && r.isError,
          );
          if (allSame) {
            const reason = `SAFETY: Detected ${config.repetitiveFailThreshold} consecutive identical failed tool calls (${toolName}). Possible infinite retry loop.`;
            logger.warn(reason);
            return {
              halt: false,
              injectPrompt:
                "SYSTEM ALERT: You are repeating a failed action with the same arguments. STOP and analyze why it is failing. Try a completely different approach or ask the user for help.",
            };
          }
        }

        // Check frustration threshold
        if (consecutiveFailures >= config.frustrationThreshold) {
          const reason = `SAFETY: ${consecutiveFailures} consecutive tool failures. Forcing agent to seek user help.`;
          logger.warn(reason);
          return {
            halt: false,
            injectPrompt: `SYSTEM ALERT: You have failed ${consecutiveFailures} times in a row. Please STOP, reflect on the situation, and ask the user for help instead of trying again.`,
          };
        }

        // Check error cascade (high error rate in sliding window)
        if (errorWindow.length >= config.errorWindowSize) {
          const errorCount = errorWindow.filter(Boolean).length;
          const errorRate = errorCount / errorWindow.length;
          if (errorRate >= config.errorRateThreshold) {
            const reason = `SAFETY: Error cascade detected. ${errorCount}/${errorWindow.length} recent operations failed (rate: ${(errorRate * 100).toFixed(0)}%). Emergency halt.`;
            logger.warn(reason);
            return { halt: true, reason };
          }
        }
      } else {
        // Success resets consecutive failure counter
        consecutiveFailures = 0;
        recentFingerprints.length = 0;
      }

      return { halt: false };
    },

    trackTokenUsage(tokens: number): void {
      totalTokensUsed += tokens;
    },

    reset(): void {
      tickCount = 0;
      totalTokensUsed = 0;
      consecutiveFailures = 0;
      recentFingerprints.length = 0;
      errorWindow.length = 0;
    },

    postRouteCheck(routeResult: RouteResult): RouteResult {
      // v2: lightweight post-route safety checks (Plan33 D-31-1)
      // Non-blocking — checks add flags but never reject (Tenet #7: rejection is policy, belongs in plugins).
      let flags: Record<string, boolean> | undefined = routeResult.flags ? { ...routeResult.flags } : undefined;

      // Check 1: Empty response guard (structural mechanism, no policy value)
      if (!routeResult.decidedBy || routeResult.decidedBy.trim() === '') {
        // decidedBy empty means no arbiter made a decision — structural issue
      }

      // Check 2: Token budget (policy value from SDK DEFAULT_POST_ROUTE_MAX_TOKEN_BUDGET)
      if (Number.isFinite(maxTokenBudget) && totalTokensUsed > maxTokenBudget) {
        logger.warn(`postRouteCheck: token budget exceeded (${totalTokensUsed}/${maxTokenBudget})`);
        flags = { ...flags, tokenBudgetExceeded: true };
      }

      // Check 3: Confidence floor (policy value from SDK DEFAULT_POST_ROUTE_CONFIDENCE_FLOOR)
      if (confidenceFloor > 0 && routeResult.confidence < confidenceFloor) {
        flags = { ...flags, lowConfidence: true };
      }

      if (flags && Object.keys(flags).length > 0) {
        return { ...routeResult, flags };
      }
      return routeResult;
    },
  };
}
