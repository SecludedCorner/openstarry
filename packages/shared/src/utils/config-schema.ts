/**
 * Zod schema for agent.json runtime validation.
 *
 * Validates the full IAgentConfig structure at load time,
 * providing clear error messages for misconfigured fields.
 */

import { z } from "zod";
import { MAX_COMM_METADATA_ENTRIES, MAX_COMM_METADATA_VALUE_SIZE } from "@openstarry/sdk";

/**
 * CommMessage metadata Zod schema — SEC-008 (Plan38 C13).
 *
 * MECHANISM: Zod validation is fail-closed (non-optional runtime enforcement).
 * Limits:
 *   - Max entries: MAX_COMM_METADATA_ENTRIES (32)
 *   - Max value size: MAX_COMM_METADATA_VALUE_SIZE (1024 bytes)
 *
 * FROZEN: Architecture_Spec Plan38, Cycle 20260328_cycle03-2.
 */
export const CommMetadataSchema = z
  .record(z.string().max(MAX_COMM_METADATA_VALUE_SIZE, `metadata value exceeds max ${MAX_COMM_METADATA_VALUE_SIZE} bytes`))
  .refine(
    (obj) => Object.keys(obj).length <= MAX_COMM_METADATA_ENTRIES,
    { message: `metadata must not exceed ${MAX_COMM_METADATA_ENTRIES} entries` },
  )
  .optional();

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

export const CommConfigSchema = z.object({
  canSendTo: z.array(z.string()).optional(),
  canReceiveFrom: z.array(z.string()).optional(),
  exposedTools: z.array(z.string()).optional(),
  maxMessageSize: z.number().int().positive().optional(),
  eventSubscriptions: z.array(z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  maxRetries: z.number().int().min(0).optional(),
  gracePeriodMs: z.number().int().min(0).max(300000).optional(),
});

/**
 * FIPA ACL performative validation (Plan38 C9).
 * Matches CommPerformative type in @openstarry/sdk.
 * MECHANISM: Zod validation, fail-closed.
 */
export const CommPerformativeSchema = z.enum([
  'inform', 'request', 'agree', 'refuse', 'propose', 'query-ref', 'cfp', 'failure',
]);

export const AgentConfigSchema = z.object({
  identity: AgentIdentitySchema,
  cognition: CognitionConfigSchema,
  capabilities: CapabilitiesConfigSchema,
  policy: PolicyConfigSchema.optional(),
  memory: MemoryConfigSchema.optional(),
  plugins: z.array(PluginRefSchema).min(1, "At least one plugin is required"),
  guide: z.string().optional(),
  // Plan32+ config fields — typed Zod schemas (Plan38 C15, BUG-2 compliance)
  safety: z.object({
    maxLoopTicks: z.number().int().positive().optional(),
    maxTokenUsage: z.number().int().positive().optional(),
    repetitiveFailThreshold: z.number().int().positive().optional(),
    frustrationThreshold: z.number().int().positive().optional(),
    errorWindowSize: z.number().int().positive().optional(),
    errorRateThreshold: z.number().min(0).max(1).optional(),
    fingerprintLength: z.number().int().positive().optional(),
  }).passthrough().optional(),
  auditTrail: z.object({
    filePath: z.string().optional(),
    maxSizeBytes: z.number().int().positive().optional(),
    maxFiles: z.number().int().positive().optional(),
    enabled: z.boolean().optional(),
  }).passthrough().optional(),
  mano: z.object({
    perArbiterMs: z.number().int().positive().optional(),
    chainMs: z.number().int().positive().optional(),
    defaultGear: z.number().int().optional(),
    baseThreshold: z.number().min(0).max(1).optional(),
    thresholdFloor: z.number().min(0).max(1).optional(),
    thresholdCeiling: z.number().min(0).max(1).optional(),
    auditTimeoutMs: z.number().int().positive().optional(),
    loopQualityAlpha: z.number().min(0).max(1).optional(),
  }).passthrough().optional(),
  confidenceAudit: z.object({
    maxAuditDelta: z.number().min(0).optional(),
  }).passthrough().optional(),
  vitakka: z.object({
    maxGearDurationMs: z.record(z.number().int().positive()).optional(),
    maxConsecutiveGearCycles: z.record(z.number().int().positive()).optional(),
  }).passthrough().optional(),
  vedanaEmergency: z.object({
    intensityThreshold: z.number().min(0).max(1).optional(),
    sustainedTicks: z.number().int().positive().optional(),
    maxThresholdBoost: z.number().min(0).optional(),
    cooldownTicks: z.number().int().positive().optional(),
  }).passthrough().optional(),
  execution: z.object({
    maxToolRounds: z.number().int().positive().optional(),
    slidingWindowSize: z.number().int().positive().optional(),
    toolTimeout: z.number().int().positive().optional(),
    llmTimeout: z.number().int().positive().optional(),
  }).passthrough().optional(),
  kleshaFilter: z.object({
    moha: z.record(z.unknown()).optional(),
    drishti: z.record(z.unknown()).optional(),
    mana: z.record(z.unknown()).optional(),
    sneha: z.record(z.unknown()).optional(),
  }).passthrough().optional(),
  maxTokenBudget: z.number().optional(),
  confidenceFloor: z.number().optional(),
  session: z.object({
    persistence: z.object({
      enabled: z.boolean().optional(),
      idleTTL: z.number().int().positive().optional(),
      maxHistorySize: z.number().int().positive().optional(),
    }).passthrough().optional(),
    replayCount: z.number().int().min(0).optional(),
  }).passthrough().optional(),
  sandbox: z.object({
    memoryLimitMb: z.number().int().positive().optional(),
    rpcTimeoutMs: z.number().int().positive().optional(),
    cpuTimeoutMs: z.number().int().positive().optional(),
  }).passthrough().optional(),
  // Plan37: Multi-agent communication config (PROC-SPEC-3 schema-config alignment)
  communication: CommConfigSchema.optional(),
}).passthrough();

export type ValidatedAgentConfig = z.infer<typeof AgentConfigSchema>;
