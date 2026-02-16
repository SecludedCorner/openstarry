/**
 * EventBus — publish/subscribe event system.
 *
 * Handlers can be sync or async. Errors in handlers are caught
 * and logged to prevent one handler from breaking the entire bus.
 */

import type { EventBus as IEventBus, EventHandler, AgentEvent } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("EventBus");

export function createEventBus(): IEventBus {
  const handlers = new Map<string, Set<EventHandler>>();
  const wildcardHandlers = new Set<EventHandler>();

  function getOrCreate(type: string): Set<EventHandler> {
    let set = handlers.get(type);
    if (!set) {
      set = new Set();
      handlers.set(type, set);
    }
    return set;
  }

  function safeCall(handler: EventHandler, event: AgentEvent): void {
    try {
      const result = handler(event);
      // If handler returns a promise, catch its rejection
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((err) => {
          logger.error("Async handler error", {
            type: event.type,
            error: String(err),
          });
        });
      }
    } catch (err) {
      logger.error("Sync handler error", {
        type: event.type,
        error: String(err),
      });
    }
  }

  const bus: IEventBus = {
    on(type: string, handler: EventHandler): () => void {
      const set = getOrCreate(type);
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },

    once(type: string, handler: EventHandler): () => void {
      const wrapper: EventHandler = (event) => {
        unsub();
        return handler(event);
      };
      const unsub = bus.on(type, wrapper);
      return unsub;
    },

    onAny(handler: EventHandler): () => void {
      wildcardHandlers.add(handler);
      return () => {
        wildcardHandlers.delete(handler);
      };
    },

    emit(event: AgentEvent): void {
      // Type-specific handlers
      const set = handlers.get(event.type);
      if (set) {
        for (const handler of set) {
          safeCall(handler, event);
        }
      }

      // Wildcard handlers
      for (const handler of wildcardHandlers) {
        safeCall(handler, event);
      }
    },
  };

  return bus;
}
