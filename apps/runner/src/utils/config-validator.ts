/**
 * Config validation with detailed error reporting.
 *
 * Validates IAgentConfig using Zod schema + semantic validation.
 */

import type { IAgentConfig } from "@openstarry/sdk";
import { AgentConfigSchema } from "@openstarry/shared";

/**
 * Individual validation error with context.
 */
export interface ConfigValidationError {
  /** Error path (e.g., "cognition.model") */
  path: string;

  /** Error message */
  message: string;

  /** Error severity */
  severity: "error" | "warning";

  /** Optional suggestion */
  suggestion?: string;
}

/**
 * Config validation result with detailed error reporting.
 */
export interface ConfigValidationResult {
  /** Validation success */
  valid: boolean;

  /** Validated config (only if valid) */
  config?: IAgentConfig;

  /** Validation errors (only if invalid) */
  errors?: ConfigValidationError[];
}

/**
 * Validate agent configuration with Zod schema + semantic rules.
 */
export function validateConfig(config: unknown): ConfigValidationResult {
  // 1. Zod schema validation
  const result = AgentConfigSchema.safeParse(config);
  if (!result.success) {
    return {
      valid: false,
      errors: parseZodErrors(result.error),
    };
  }

  // 2. Semantic validation (beyond schema)
  const allErrors = validateSemantics(result.data as IAgentConfig);

  // Determine validity based on error severity
  const hasErrors = allErrors.some(e => e.severity === "error");
  if (hasErrors) {
    return {
      valid: false,
      errors: allErrors,
    };
  }

  // Valid but may have warnings
  return {
    valid: true,
    config: result.data as IAgentConfig,
    errors: allErrors.length > 0 ? allErrors : undefined,
  };
}

/**
 * Semantic validation checks (beyond schema structure).
 */
function validateSemantics(config: IAgentConfig): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  // Check if allowedPaths is empty (warning, not blocking)
  if (!config.capabilities.allowedPaths || config.capabilities.allowedPaths.length === 0) {
    errors.push({
      path: "capabilities.allowedPaths",
      message: "No allowed paths configured. This will be defaulted to process.cwd()",
      severity: "warning",
      suggestion: "Add process.cwd() or a specific directory to allowedPaths",
    });
  }

  // Check if tools array is empty
  if (!config.capabilities.tools || config.capabilities.tools.length === 0) {
    errors.push({
      path: "capabilities.tools",
      message: "No tools configured",
      severity: "error",
      suggestion: "Add at least one tool capability (e.g., 'fs.read')",
    });
  }

  // Check negative values
  if (config.cognition.temperature !== undefined && config.cognition.temperature < 0) {
    errors.push({
      path: "cognition.temperature",
      message: "Temperature must be non-negative",
      severity: "error",
    });
  }

  if (config.cognition.maxToolRounds !== undefined && config.cognition.maxToolRounds < 1) {
    errors.push({
      path: "cognition.maxToolRounds",
      message: "maxToolRounds must be at least 1",
      severity: "error",
    });
  }

  // Return all errors and warnings
  return errors;
}

/**
 * Convert Zod errors to ConfigValidationError format.
 */
function parseZodErrors(zodError: { issues: Array<{ path: Array<string | number>; message: string }> }): ConfigValidationError[] {
  return zodError.issues.map((issue: { path: Array<string | number>; message: string }) => ({
    path: issue.path.join("."),
    message: issue.message,
    severity: "error" as const,
  }));
}
