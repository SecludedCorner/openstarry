/**
 * Tool interface — executable actions.
 * @skandha samskara (行蘊 — 意志行動)
 */

import type { z } from "zod";
import type { EventBus } from "./events.js";
import type { ISamskara } from "./aggregates.js";

/** Context passed to a tool during execution. */
export interface ToolContext {
  workingDirectory: string;
  allowedPaths: string[];
  signal?: AbortSignal;
  bus: EventBus;
}

/**
 * Tool metadata for interactive decision support.
 * NEW IN v0.33.0-alpha (Plan33 D4-4 T2).
 *
 * Enables IGuide and IVolition to make informed decisions about
 * tool execution without parsing tool descriptions.
 */
export interface IToolMetadata {
  /**
   * Whether this tool has observable side effects (file write, API call, etc.).
   * When true, downstream consumers (IVolition, confirmation gates) may
   * apply additional scrutiny.
   * Default: false (pure/read-only tool).
   */
  hasSideEffects?: boolean;

  /**
   * Risk category for this tool invocation.
   * - 'safe': No destructive potential (e.g., read file, search)
   * - 'moderate': Reversible side effects (e.g., write file, create resource)
   * - 'destructive': Irreversible side effects (e.g., delete, send email)
   * Default: 'safe'.
   */
  riskCategory?: 'safe' | 'moderate' | 'destructive';

  /**
   * Whether this tool should require user confirmation before execution.
   * This is a declarative hint — enforcement depends on the confirmation
   * gate implementation (Plan35 Dir B / Plan36).
   * Default: false.
   */
  requiresConfirmation?: boolean;
}

/** A tool definition that can be registered with the agent. */
export interface ITool<TInput = unknown> extends ISamskara {
  id: string;
  description: string;
  parameters: z.ZodType<TInput>;
  execute(input: TInput, ctx: ToolContext): Promise<string>;

  /**
   * Tool metadata for interactive decision support (optional).
   * NEW IN v0.33.0-alpha (Plan33 D4-4 T2).
   */
  metadata?: IToolMetadata;
}

/** JSON Schema representation of a tool for provider APIs. */
export interface ToolJsonSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
