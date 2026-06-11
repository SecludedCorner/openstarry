/**
 * Default ratio of recent turns to preserve (not compress).
 * Used by context-summary plugin. Policy-adjacent default (SUSSMAN Layer 2).
 */
export const DEFAULT_CONTEXT_SUMMARY_PRESERVE_RATIO = 0.5;

/**
 * Default prompt for LLM-based conversation summarization.
 * Policy-adjacent default (SUSSMAN Layer 2).
 */
export const DEFAULT_SUMMARY_PROMPT = 'Summarize the following conversation concisely, preserving key facts, decisions, and context needed to continue the conversation. Output only the summary, no preamble.';

/**
 * Minimum estimated tokens in compressible region before summarization triggers.
 * Below this threshold, all messages pass through uncompressed.
 * Policy-adjacent default (SUSSMAN Layer 2).
 */
export const DEFAULT_MIN_COMPRESS_TOKENS = 500;
