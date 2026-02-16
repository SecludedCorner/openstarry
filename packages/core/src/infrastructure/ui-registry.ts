/**
 * UIRegistry — manages UI renderers (色蘊).
 */

import type { IUI } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("UIRegistry");

export interface UIRegistry {
  register(ui: IUI): void;
  get(id: string): IUI | undefined;
  list(): IUI[];
}

export function createUIRegistry(): UIRegistry {
  const uis = new Map<string, IUI>();

  return {
    register(ui: IUI): void {
      logger.debug(`Registering UI: ${ui.id}`);
      uis.set(ui.id, ui);
    },

    get(id: string): IUI | undefined {
      return uis.get(id);
    },

    list(): IUI[] {
      return [...uis.values()];
    },
  };
}
