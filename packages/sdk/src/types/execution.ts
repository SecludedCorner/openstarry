/**
 * ExecutionConfig — execution loop configuration.
 *
 * Plan32 Wave 4 (P1): extracted from agent-core.ts hardcoded defaults.
 * All values are required at runtime; IAgentConfig accepts Partial overrides.
 *
 * @skandha samskara (行蘊)
 * @module execution
 */

/**
 * Execution loop configuration.
 */
export interface ExecutionConfig {
  /** Maximum tool execution rounds per event (default: 10) */
  readonly maxToolRounds: number;
  /** Sliding window size for context assembly (default: 5) */
  readonly slidingWindowSize: number;
  /** Tool execution timeout in ms (default: 30000 = 30s) */
  readonly toolTimeout: number;
  /** LLM call timeout in ms (default: 120000 = 2 minutes) */
  readonly llmTimeout: number;
}

/**
 * Default execution configuration.
 * Canonical source of truth per SUSSMAN three-layer model.
 */
export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  maxToolRounds: 10,
  slidingWindowSize: 5,
  toolTimeout: 30000,
  llmTimeout: 120000,
};
