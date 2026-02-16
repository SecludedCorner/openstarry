/**
 * Cognition configuration service interface.
 * Provides per-session model/provider selection.
 */

import type { IPluginService } from "./service.js";

/** Service interface for runtime cognition configuration (model/provider selection). */
export interface ICognitionConfigService extends IPluginService {
  getModel(sessionId?: string): string | undefined;
  setModel(modelId: string, sessionId?: string): void;
  getProvider(sessionId?: string): string | undefined;
  setProvider(providerId: string, sessionId?: string): void;
}
