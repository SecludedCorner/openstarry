/**
 * Tool interface and context types.
 */

import type { z } from "zod";
import type { EventBus } from "./events.js";

/** Context passed to a tool during execution. */
export interface ToolContext {
  workingDirectory: string;
  allowedPaths: string[];
  signal?: AbortSignal;
  bus: EventBus;
}

/** A tool definition that can be registered with the agent. */
export interface ITool<TInput = unknown> {
  id: string;
  description: string;
  parameters: z.ZodType<TInput>;
  execute(input: TInput, ctx: ToolContext): Promise<string>;
}

/** JSON Schema representation of a tool for provider APIs. */
export interface ToolJsonSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
