/**
 * GuideRegistry — manages persona/guide providers.
 * @skandha vijnana (識蘊 — 我執框架·行為約束)
 *
 * Cycle 03-31 FIX-B (A1-4 BG-3 HIGH mitigation, SUSSMAN amendment per R3 §5.5):
 *   `register()` now strict by default — throws on duplicate guideId.
 *   Opt-in `{ allowReplace: true }` permits replacement (warn-logged).
 *   Default strict mode upholds ZT-1 character-identity drift防護.
 */

import type { IGuide } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("GuideRegistry");

export interface GuideRegisterOptions {
  /**
   * When `true`, an incoming guide whose `id` already exists is allowed to
   * replace the prior registration (warn-logged). When `false` (default),
   * a duplicate `id` throws — preventing silent character-identity overwrite
   * (cycle 03-30 A1-4 BG-3 HIGH; ZT-1 strict mode).
   */
  allowReplace?: boolean;
}

export interface GuideRegistry {
  register(guide: IGuide, options?: GuideRegisterOptions): void;
  get(id: string): IGuide | undefined;
  list(): IGuide[];
}

export function createGuideRegistry(): GuideRegistry {
  const guides = new Map<string, IGuide>();

  return {
    register(guide: IGuide, options?: GuideRegisterOptions): void {
      const existing = guides.get(guide.id);
      if (existing) {
        if (!options?.allowReplace) {
          throw new Error(
            `GuideRegistry: duplicate guide id "${guide.id}" — strict mode (pass { allowReplace: true } to override). ` +
            `Prior name="${existing.name}" → incoming name="${guide.name}".`
          );
        }
        logger.warn(
          `Replacing guide "${guide.id}" (allowReplace=true): "${existing.name}" → "${guide.name}"`
        );
      } else {
        logger.debug(`Registering guide: ${guide.id}`);
      }
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
