/**
 * Zod schema for agent.json runtime validation.
 *
 * Validates the full IAgentConfig structure at load time,
 * providing clear error messages for misconfigured fields.
 */

import { z } from "zod";

export const PluginRefSchema = z.object({
  name: z.string().min(1, "Plugin name must not be empty"),
  path: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

export const AgentIdentitySchema = z.object({
  id: z.string().min(1, "Agent id must not be empty"),
  name: z.string().min(1, "Agent name must not be empty"),
  description: z.string().optional(),
  version: z.string().optional(),
});

export const CognitionConfigSchema = z.object({
  provider: z.string().optional().default(""),
  model: z.string().optional().default(""),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  maxToolRounds: z.number().int().positive().optional(),
});

export const CapabilitiesConfigSchema = z.object({
  tools: z.array(z.string()),
  allowedPaths: z.array(z.string()).optional(),
});

export const PolicyConfigSchema = z.object({
  maxConcurrentTools: z.number().int().positive().optional(),
  toolTimeout: z.number().int().positive().optional(),
  pathRestrictions: z.array(z.string()).optional(),
});

export const MemoryConfigSchema = z.object({
  slidingWindowSize: z.number().int().nonnegative(),
});

export const AgentConfigSchema = z.object({
  identity: AgentIdentitySchema,
  cognition: CognitionConfigSchema,
  capabilities: CapabilitiesConfigSchema,
  policy: PolicyConfigSchema.optional(),
  memory: MemoryConfigSchema.optional(),
  plugins: z.array(PluginRefSchema).min(1, "At least one plugin is required"),
  guide: z.string().optional(),
});

export type ValidatedAgentConfig = z.infer<typeof AgentConfigSchema>;
