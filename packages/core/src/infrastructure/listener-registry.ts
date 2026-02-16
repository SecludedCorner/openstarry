/**
 * ListenerRegistry — manages event listeners.
 */

import type { IListener } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("ListenerRegistry");

export interface ListenerRegistry {
  register(listener: IListener): void;
  get(id: string): IListener | undefined;
  list(): IListener[];
}

export function createListenerRegistry(): ListenerRegistry {
  const listeners = new Map<string, IListener>();

  return {
    register(listener: IListener): void {
      logger.debug(`Registering listener: ${listener.id}`);
      listeners.set(listener.id, listener);
    },

    get(id: string): IListener | undefined {
      return listeners.get(id);
    },

    list(): IListener[] {
      return [...listeners.values()];
    },
  };
}
