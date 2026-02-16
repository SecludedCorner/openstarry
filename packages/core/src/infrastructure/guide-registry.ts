/**
 * GuideRegistry — manages persona/guide providers.
 */

import type { IGuide } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("GuideRegistry");

export interface GuideRegistry {
  register(guide: IGuide): void;
  get(id: string): IGuide | undefined;
  list(): IGuide[];
}

export function createGuideRegistry(): GuideRegistry {
  const guides = new Map<string, IGuide>();

  return {
    register(guide: IGuide): void {
      logger.debug(`Registering guide: ${guide.id}`);
      guides.set(guide.id, guide);
    },

    get(id: string): IGuide | undefined {
      return guides.get(id);
    },

    list(): IGuide[] {
      return [...guides.values()];
    },
  };
}
