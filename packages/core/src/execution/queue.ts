/**
 * EventQueue — async FIFO queue for internal events.
 *
 * Used to decouple event producers (listeners, transport) from the
 * execution loop consumer. The loop pulls events one at a time.
 */

import type { AgentEvent } from "@openstarry/sdk";

export interface EventQueue {
  push(event: AgentEvent): void;
  pull(): Promise<AgentEvent>;
  clear(): void;
}

export function createEventQueue(): EventQueue {
  const buffer: AgentEvent[] = [];
  let resolver: ((event: AgentEvent) => void) | null = null;

  return {
    push(event: AgentEvent): void {
      if (resolver) {
        // Someone is waiting — deliver immediately
        const resolve = resolver;
        resolver = null;
        resolve(event);
      } else {
        buffer.push(event);
      }
    },

    pull(): Promise<AgentEvent> {
      if (buffer.length > 0) {
        return Promise.resolve(buffer.shift()!);
      }
      // Wait for next push
      return new Promise<AgentEvent>((resolve) => {
        resolver = resolve;
      });
    },

    clear(): void {
      buffer.length = 0;
      resolver = null;
    },
  };
}
