/**
 * Zod schemas for .openstarry/ project configuration files.
 * Plan34: Project-Level Config Support.
 *
 * These schemas are used in Wave 2 permission-validator.ts (Step 8).
 * Placing schemas in @openstarry/shared avoids adding a zod dependency
 * to apps/runner directly.
 */

import { z } from "zod";

export const ProjectPluginRefSchema = z.object({
  name: z.string().min(1, "Plugin name must not be empty"),
  path: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  criticality: z.enum(["required", "optional-degraded", "optional-no-effect"]).optional(),
});

export const ProjectConfigSchema = z.object({
  identity: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
  }).optional(),
  cognition: z.object({
    temperature: z.number().min(0).max(2).optional(),
    maxRetries: z.number().int().nonnegative().optional(),
  }).optional(),
  memory: z.object({
    strategy: z.string().optional(),
  }).optional(),
}).strict();
// NOTE: .strict() rejects unknown keys, which prevents security fields from
// silently passing through config.json as neutral overrides. Unknown keys
// trigger a WARN (not an error) in the two-phase validation.

export const ProjectPermissionsSchema = z.object({
  allowedPaths: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  deniedTools: z.array(z.string()).optional(),
  maxConcurrentTools: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  maxTokenUsage: z.number().int().nonnegative().optional(),
  confidenceFloor: z.number().min(0).max(1).optional(),
  safetyMinimumGear: z.number().int().min(1).optional(),
}).strict();
// SEC-004 fix: .strict() rejects unknown keys in permissions.json, preventing
// future schema/code drift where a new security field is silently discarded.

export const ProjectPluginsSchema = z.object({
  plugins: z.array(ProjectPluginRefSchema).min(1, "plugins array must not be empty if file is present"),
});

export type ValidatedProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type ValidatedProjectPermissions = z.infer<typeof ProjectPermissionsSchema>;
export type ValidatedProjectPlugins = z.infer<typeof ProjectPluginsSchema>;
