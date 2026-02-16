/**
 * TransportBridge — bridges events to the agent and routes output
 * to registered UI renderers (色蘊).
 */

import type { EventBus, AgentEvent } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";
import type { UIRegistry } from "../infrastructure/ui-registry.js";

const logger = createLogger("TransportBridge");

export interface TransportBridge {
  /** Forward an event to all registered UI renderers. */
  broadcast(event: AgentEvent): void;
  /** Start listening on the bus and forwarding to UIs. */
  start(): () => void;
}

export function createTransportBridge(
  bus: EventBus,
  uiRegistry: UIRegistry,
): TransportBridge {
  function broadcast(event: AgentEvent): void {
    for (const ui of uiRegistry.list()) {
      try {
        const result = ui.onEvent(event);
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch((err) => {
            logger.error(`UI ${ui.id} error`, { error: String(err) });
          });
        }
      } catch (err) {
        logger.error(`UI ${ui.id} sync error`, { error: String(err) });
      }
    }
  }

  return {
    broadcast,

    start(): () => void {
      // Subscribe to all events and forward to UIs
      const unsub = bus.onAny((event: AgentEvent) => {
        broadcast(event);
      });
      return unsub;
    },
  };
}
