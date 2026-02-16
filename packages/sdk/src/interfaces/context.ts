/**
 * Context manager interface — manages what the LLM sees.
 */

import type { Message } from "../types/message.js";

/** Manages the context window sent to the LLM. */
export interface IContextManager {
  /** Assemble messages for the LLM, applying sliding window and other strategies. */
  assembleContext(messages: Message[], maxTurns: number): Message[];
}
