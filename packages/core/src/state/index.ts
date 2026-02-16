/**
 * StateManager — in-memory conversation history management.
 *
 * Implements IStateManager. For MVP, state lives in process memory.
 */

import type { IStateManager, Message } from "@openstarry/sdk";

export function createStateManager(): IStateManager {
  let messages: Message[] = [];

  return {
    getMessages(): Message[] {
      return [...messages];
    },

    addMessage(message: Message): void {
      messages.push(message);
    },

    clear(): void {
      messages = [];
    },

    snapshot(): Message[] {
      return JSON.parse(JSON.stringify(messages)) as Message[];
    },

    restore(snap: Message[]): void {
      messages = JSON.parse(JSON.stringify(snap)) as Message[];
    },
  };
}
