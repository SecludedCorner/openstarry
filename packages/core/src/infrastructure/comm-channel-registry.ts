/**
 * CommChannelRegistry — manages registered ICommChannel instances.
 *
 * Follows the VedanaRegistry pattern (array-backed, name-keyed).
 * Channels are registered from PluginHooks.commChannels by PluginLoader.
 *
 * Plan37 C6: commChannels array hook slot.
 */

import type { ICommChannel, CommCapability, CommTopology } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("CommChannelRegistry");

export interface CommChannelRegistry {
  register(channel: ICommChannel): void;
  unregister(name: string): void;
  get(name: string): ICommChannel | undefined;
  list(): ICommChannel[];
  findByCapability(cap: CommCapability): ICommChannel[];
  findByTopology(topology: CommTopology): ICommChannel[];
}

export function createCommChannelRegistry(): CommChannelRegistry {
  const channels = new Map<string, ICommChannel>();

  return {
    register(channel: ICommChannel): void {
      logger.debug(`Registering comm channel: ${channel.name} (topology: ${channel.topology})`);
      channels.set(channel.name, channel);
    },

    unregister(name: string): void {
      const existed = channels.has(name);
      channels.delete(name);
      if (existed) {
        logger.debug(`Unregistered comm channel: ${name}`);
      }
    },

    get(name: string): ICommChannel | undefined {
      return channels.get(name);
    },

    list(): ICommChannel[] {
      return [...channels.values()];
    },

    findByCapability(cap: CommCapability): ICommChannel[] {
      return [...channels.values()].filter(ch => ch.capabilities.includes(cap));
    },

    findByTopology(topology: CommTopology): ICommChannel[] {
      return [...channels.values()].filter(ch => ch.topology === topology);
    },
  };
}
