/**
 * VedanaRegistry — manages registered vedana sensors.
 * @skandha vedana (受蘊 — 三受感測)
 */

import type { IVedanaSensor } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("VedanaRegistry");

export interface VedanaRegistry {
  register(sensor: IVedanaSensor): void;
  get(id: string): IVedanaSensor | undefined;
  list(): IVedanaSensor[];
  remove(id: string): boolean;
}

export function createVedanaRegistry(): VedanaRegistry {
  const sensors = new Map<string, IVedanaSensor>();

  return {
    register(sensor: IVedanaSensor): void {
      logger.debug(`Registering vedana sensor: ${sensor.id} (channel: ${sensor.channel})`);
      sensors.set(sensor.id, sensor);
    },

    get(id: string): IVedanaSensor | undefined {
      return sensors.get(id);
    },

    list(): IVedanaSensor[] {
      return [...sensors.values()];
    },

    remove(id: string): boolean {
      const existed = sensors.has(id);
      sensors.delete(id);
      if (existed) {
        logger.debug(`Removed vedana sensor: ${id}`);
      }
      return existed;
    },
  };
}
