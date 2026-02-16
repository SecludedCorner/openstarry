/**
 * SafetyMonitor — multi-level circuit breaker system.
 *
 * Level 1: Resource limits (token budget, loop cap)
 * Level 2: Behavioral analysis (repetitive tool calls, error cascade)
 * Level 3: Frustration counter (consecutive failures → ask user for help)
 *
 * Per design doc: 07_Safety_Circuit_Breakers.md & 12_Error_Handling_and_Self_Correction.md
 */

import { createHash } from "node:crypto";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("SafetyMonitor");

export interface SafetyCheckResult {
  halt: boolean;
  reason?: string;
  injectPrompt?: string;
}

export interface SafetyMonitorConfig {
  /** Max loop ticks per task (default: 50) */
  maxLoopTicks: number;
  /** Max total token usage (default: 100000, 0 = unlimited) */
  maxTokenUsage: number;
  /** Consecutive identical failed tool calls to trigger breaker (default: 3) */
  repetitiveFailThreshold: number;
  /** Consecutive failures before forcing "ask user for help" (default: 5) */
  frustrationThreshold: number;
  /** Error rate window size (default: 10) */
  errorWindowSize: number;
  /** Error rate threshold to trigger cascade breaker (default: 0.8) */
  errorRateThreshold: number;
}

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
}

const DEFAULT_CONFIG: SafetyMonitorConfig = {
  maxLoopTicks: 50,
  maxTokenUsage: 100000,
  repetitiveFailThreshold: 3,
  frustrationThreshold: 5,
  errorWindowSize: 10,
  errorRateThreshold: 0.8,
};

export function createSafetyMonitor(
  overrides?: Partial<SafetyMonitorConfig>,
): SafetyMonitor {
  const config = { ...DEFAULT_CONFIG, ...overrides };

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
      .slice(0, 16);
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
  };
}
