/**
 * ProviderRegistry — manages LLM provider adapters.
 */

import type { IProvider, ModelInfo } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("ProviderRegistry");

export interface ProviderRegistry {
  register(provider: IProvider): void;
  get(id: string): IProvider | undefined;
  resolveModel(modelId: string): { provider: IProvider; model: ModelInfo } | undefined;
  list(): IProvider[];
}

export function createProviderRegistry(): ProviderRegistry {
  const providers = new Map<string, IProvider>();

  return {
    register(provider: IProvider): void {
      logger.debug(`Registering provider: ${provider.id}`);
      providers.set(provider.id, provider);
    },

    get(id: string): IProvider | undefined {
      return providers.get(id);
    },

    resolveModel(modelId: string): { provider: IProvider; model: ModelInfo } | undefined {
      for (const provider of providers.values()) {
        const model = provider.models.find((m) => m.id === modelId);
        if (model) {
          return { provider, model };
        }
      }
      return undefined;
    },

    list(): IProvider[] {
      return [...providers.values()];
    },
  };
}
