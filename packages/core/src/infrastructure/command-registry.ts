/**
 * CommandRegistry — manages slash commands registered by plugins.
 *
 * Uses a handler-chain pattern: multiple commands can share the same name.
 * On execute, handlers are tried in registration order; returning undefined
 * means "not handled — pass to next handler".
 */

import type { SlashCommand, IPluginContext } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("CommandRegistry");

/** UUID v4 format validation (SEC-032-002). */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CommandRegistry {
  register(command: SlashCommand): void;
  get(name: string): SlashCommand | undefined;
  list(): SlashCommand[];
  execute(name: string, args: string, ctx: IPluginContext, sessionId?: string): Promise<string | undefined>;
}

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, SlashCommand[]>();

  return {
    register(command: SlashCommand): void {
      logger.debug(`Registering command: /${command.name}`);
      const existing = commands.get(command.name);
      if (existing) {
        existing.push(command);
      } else {
        commands.set(command.name, [command]);
      }
    },

    get(name: string): SlashCommand | undefined {
      const handlers = commands.get(name);
      return handlers?.[0];
    },

    list(): SlashCommand[] {
      const seen = new Set<string>();
      const result: SlashCommand[] = [];
      for (const [name, handlers] of commands) {
        if (!seen.has(name)) {
          seen.add(name);
          result.push(handlers[0]);
        }
      }
      return result;
    },

    async execute(name: string, args: string, ctx: IPluginContext, sessionId?: string): Promise<string | undefined> {
      if (sessionId && !UUID_V4_REGEX.test(sessionId)) {
        logger.warn(`Invalid session ID format rejected: ${sessionId}`);
        return undefined;
      }

      const handlers = commands.get(name);
      if (!handlers || handlers.length === 0) return undefined;

      for (const handler of handlers) {
        const result = await handler.execute(args, ctx, sessionId);
        if (result !== undefined) return result;
      }
      return undefined;
    },
  };
}
