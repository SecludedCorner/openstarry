/**
 * ToolRegistry — manages registered tools.
 */

import type { ITool, ToolJsonSchema } from "@openstarry/sdk";
import { zodToJsonSchema } from "@openstarry/shared";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("ToolRegistry");

export interface ToolRegistry {
  register(tool: ITool): void;
  get(id: string): ITool | undefined;
  list(): ITool[];
  toJsonSchemas(): ToolJsonSchema[];
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ITool>();

  return {
    register(tool: ITool): void {
      logger.debug(`Registering tool: ${tool.id}`);
      tools.set(tool.id, tool);
    },

    get(id: string): ITool | undefined {
      return tools.get(id);
    },

    list(): ITool[] {
      return [...tools.values()];
    },

    toJsonSchemas(): ToolJsonSchema[] {
      return [...tools.values()].map((tool) => ({
        name: tool.id,
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters),
      }));
    },
  };
}
