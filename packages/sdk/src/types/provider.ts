/**
 * Provider interface — LLM backends.
 */

import type { Message, ProviderStreamEvent } from "./message.js";
import type { ToolJsonSchema } from "./tool.js";

/** Information about a model offered by a provider. */
export interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

/** A chat request to the provider. */
export interface ChatRequest {
  model: string;
  messages: Message[];
  systemPrompt?: string;
  tools?: ToolJsonSchema[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/** Metadata describing how to authenticate with a provider. */
export interface LoginHint {
  /** Login command arguments pattern, e.g. "<API_KEY>", "<ID> <SECRET>", "[URL]" */
  usage: string;
  /** Short description, e.g. "Google AI", "Anthropic" */
  description?: string;
  /** URL for obtaining credentials */
  docUrl?: string;
}

/** Provider adapter interface. */
export interface IProvider {
  id: string;
  name: string;
  models: ModelInfo[];
  chat(request: ChatRequest): AsyncIterable<ProviderStreamEvent>;
  /** Returns true if the provider has valid credentials configured. */
  isConfigured?(): boolean;
  /** Optional login hint metadata for banner/help display. */
  loginHint?: LoginHint;
}

/** Agent context passed to the provider during initialization. */
export interface IAgentContext {
  agentId: string;
  workingDirectory: string;
}
