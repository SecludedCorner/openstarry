/**
 * State manager interface — manages conversation history.
 */

import type { Message } from "../types/message.js";

/** Manages conversation state and history. */
export interface IStateManager {
  /** Get all messages in the current conversation. */
  getMessages(): Message[];

  /** Add a message to the conversation. */
  addMessage(message: Message): void;

  /** Clear all messages (reset). */
  clear(): void;

  /** Create a snapshot of current state. */
  snapshot(): Message[];

  /** Restore state from a snapshot. */
  restore(snapshot: Message[]): void;
}
