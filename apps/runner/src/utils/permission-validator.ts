/**
 * Permission validation for .openstarry/ project configuration.
 * Plan34: Project-Level Config Support.
 *
 * Implements the 10-step validation flow (D2-R6) including:
 * - Symlink defense (realpathSync before read)
 * - Path containment checks (isPathSafe)
 * - Config file size limit (1MB)
 * - Zod schema validation
 * - Semantic path validation
 *
 * SEC-003 NOTE: The existsSync → realpathSync → readFileSync sequence has an
 * inherent TOCTOU (time-of-check-time-of-use) race window. This is a known
 * limitation of synchronous FS operations; the residual risk is low because
 * .openstarry/ files are loaded once at startup in a single-threaded context.
 */

import { existsSync, statSync, realpathSync, readFileSync } from "node:fs";
import { resolve, normalize, sep, join } from "node:path";
import type { IProjectContext, IProjectConfig, IProjectPermissions, IProjectPlugins } from "@openstarry/sdk";
import {
  ProjectConfigSchema,
  ProjectPermissionsSchema,
  ProjectPluginsSchema,
} from "@openstarry/shared";
import { applySchemaDriftPolicy } from "../schema-drift-policy/index.js";

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Result of a full 10-step project config validation run.
 */
export interface ProjectValidationResult {
  projectConfig: IProjectConfig | null;
  projectPermissions: IProjectPermissions | null;
  projectPlugins: IProjectPlugins | null;
}

const MAX_CONFIG_SIZE = 1_048_576; // 1MB

/**
 * Verify that a candidate path is safely contained within the project root.
 *
 * Algorithm (cross-platform safe):
 * 1. realpathSync(projectRoot) → realRoot
 * 2. resolve(realRoot, candidate) → realCandidate (resolves relative + symlinks)
 * 3. normalize(realRoot) + sep → normalizedRoot (ensures trailing separator)
 * 4. On Windows: toLowerCase() both sides before comparison (case-insensitive FS)
 * 5. On Windows: reject UNC candidate paths (startsWith("\\\\"))
 * 6. Return normalizedCandidate.startsWith(normalizedRoot)
 *
 * @param projectRoot - Absolute path to project root (pre-verified real path).
 * @param candidate - Path to test (may be relative or absolute).
 * @returns true if candidate is safely within projectRoot, false otherwise.
 */
export function isPathSafe(projectRoot: string, candidate: string): boolean {
  const realRoot = realpathSync(projectRoot);
  const realCandidate = resolve(realRoot, candidate);
  const normalizedRoot = normalize(realRoot) + sep;
  const normalizedCandidate = normalize(realCandidate);
  const comparableRoot = process.platform === "win32"
    ? normalizedRoot.toLowerCase() : normalizedRoot;
  const comparableCandidate = process.platform === "win32"
    ? normalizedCandidate.toLowerCase() : normalizedCandidate;
  // Windows UNC paths are unconditionally rejected
  if (process.platform === "win32" && normalizedCandidate.startsWith("\\\\")) {
    return false;
  }
  return comparableCandidate.startsWith(comparableRoot);
}

/**
 * Execute the full 10-step validation flow for a project context.
 *
 * Steps 1-4: Security checks on the .openstarry/ directory itself.
 *   Failure mode: throws SecurityError (startup aborted).
 * Step 5: Per-file existence check.
 *   Failure mode: graceful skip (returns null for absent file).
 * Steps 6-9: Per-file content validation (size, JSON, Zod schema, semantic).
 *   Failure mode: throws ConfigError (startup aborted).
 * Step 10: Delegated to mergeConfigs() — empty-set fail-fast.
 *   Failure mode: throws ConfigError (startup aborted).
 *
 * @param context - The IProjectContext from findProjectRoot().
 * @returns Parsed and validated project config objects.
 * @throws SecurityError for directory-level security failures (Steps 1-4).
 * @throws ConfigError for content-level validation failures (Steps 6-9).
 */
export async function validateProjectConfig(
  context: IProjectContext,
): Promise<ProjectValidationResult> {
  const { projectRoot, dotOpenstarryPath } = context;

  // Steps 1-4: Directory security checks
  try {
    // Step 1: existsSync
    if (!existsSync(dotOpenstarryPath)) {
      throw new SecurityError(`'.openstarry' directory not found at: ${dotOpenstarryPath}`);
    }

    // Step 2: isDirectory
    if (!statSync(dotOpenstarryPath).isDirectory()) {
      throw new SecurityError(`'.openstarry' is not a directory`);
    }

    // Step 3: realpathSync
    let realDotPath: string;
    try {
      realDotPath = realpathSync(dotOpenstarryPath);
    } catch (err) {
      throw new SecurityError(
        `Failed to resolve '.openstarry' real path: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Step 4: isPathSafe
    if (!isPathSafe(projectRoot, realDotPath)) {
      throw new SecurityError(
        `'.openstarry' resolves outside project root (possible symlink attack)`
      );
    }

    // Steps 5-9: Per-file validation
    const projectConfig = await validateConfigFile(
      projectRoot,
      realDotPath,
      "config.json",
      "config",
    );
    const projectPermissions = await validatePermissionsFile(
      projectRoot,
      realDotPath,
      "permissions.json",
    );
    const projectPlugins = await validatePluginsFile(
      projectRoot,
      realDotPath,
      "plugins.json",
    );

    return { projectConfig, projectPermissions, projectPlugins };
  } catch (err) {
    if (err instanceof SecurityError || err instanceof ConfigError) {
      throw err;
    }
    throw new SecurityError(
      `Unexpected error validating project config: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function validateConfigFile(
  projectRoot: string,
  realDotPath: string,
  filename: string,
  _type: "config",
): Promise<IProjectConfig | null> {
  const filePath = join(realDotPath, filename);

  // Step 5: existence check
  if (!existsSync(filePath)) {
    return null;
  }

  // Step 6: per-file symlink defense + size check
  let realFilePath: string;
  try {
    realFilePath = realpathSync(filePath);
  } catch (err) {
    throw new SecurityError(
      `Failed to resolve real path for ${filename}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!isPathSafe(projectRoot, realFilePath)) {
    throw new SecurityError(`${filename} resolves outside project root (possible symlink attack)`);
  }
  const fileSize = statSync(realFilePath).size;
  if (fileSize >= MAX_CONFIG_SIZE) {
    throw new ConfigError(`Project config file exceeds 1MB limit: ${filename}`);
  }

  // Step 7: JSON parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(realFilePath, "utf-8"));
  } catch (err) {
    throw new ConfigError(
      `Invalid JSON in project config: ${filename}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Step 8: Zod schema validation (strict — unknown keys trigger WARN)
  const result = ProjectConfigSchema.safeParse(parsed);
  if (!result.success) {
    // Check if failure is only due to unknown keys (strict mode)
    const issues = result.error.issues;
    const unknownKeyIssues = issues.filter(i => i.code === "unrecognized_keys");
    const otherIssues = issues.filter(i => i.code !== "unrecognized_keys");

    if (otherIssues.length > 0) {
      throw new ConfigError(
        `Project config schema error in ${filename}: ${result.error.issues.map(i => i.message).join("; ")}`
      );
    }

    // Only unknown keys — emit WARN and extract known neutral fields
    for (const issue of unknownKeyIssues) {
      const keys = (issue as { keys?: string[] }).keys ?? [];
      for (const key of keys) {
        console.warn(`[cli] WARNING: Unknown field '${key}' found in config.json; field ignored.`);
      }
    }

    // Re-parse with only the known neutral fields
    const neutralOnly = pickKnownNeutralFields(parsed as Record<string, unknown>);
    const retryResult = ProjectConfigSchema.safeParse(neutralOnly);
    if (!retryResult.success) {
      throw new ConfigError(
        `Project config schema error in ${filename}: ${retryResult.error.issues.map(i => i.message).join("; ")}`
      );
    }
    return retryResult.data as IProjectConfig;
  }

  return result.data as IProjectConfig;
}

function pickKnownNeutralFields(raw: Record<string, unknown>): Record<string, unknown> {
  const known: Record<string, unknown> = {};
  if ("identity" in raw) known["identity"] = raw["identity"];
  if ("cognition" in raw) known["cognition"] = raw["cognition"];
  if ("memory" in raw) known["memory"] = raw["memory"];
  return known;
}

async function validatePermissionsFile(
  projectRoot: string,
  realDotPath: string,
  filename: string,
): Promise<IProjectPermissions | null> {
  const filePath = join(realDotPath, filename);

  // Step 5: existence check
  if (!existsSync(filePath)) {
    return null;
  }

  // Step 6: per-file symlink defense + size check
  let realFilePath: string;
  try {
    realFilePath = realpathSync(filePath);
  } catch (err) {
    throw new SecurityError(
      `Failed to resolve real path for ${filename}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!isPathSafe(projectRoot, realFilePath)) {
    throw new SecurityError(`${filename} resolves outside project root (possible symlink attack)`);
  }
  const fileSize = statSync(realFilePath).size;
  if (fileSize >= MAX_CONFIG_SIZE) {
    throw new ConfigError(`Project config file exceeds 1MB limit: ${filename}`);
  }

  // Step 7: JSON parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(realFilePath, "utf-8"));
  } catch (err) {
    throw new ConfigError(
      `Invalid JSON in project config: ${filename}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Step 8: Zod schema validation — routed through Plan49 C49-M3 schema-drift policy.
  // Historical behaviour is "throw on any invalid input"; keeping that contract by
  // surfacing policy failures as ConfigError regardless of current global mode.
  const policy = applySchemaDriftPolicy(ProjectPermissionsSchema, parsed, `${filename}`);
  if (!policy.ok) {
    throw new ConfigError(`Project config schema error in ${filename}: ${policy.error}`);
  }
  const permissions = policy.data as IProjectPermissions;

  // Step 9: Semantic validation — validate allowedPaths entries
  if (permissions.allowedPaths) {
    for (const p of permissions.allowedPaths) {
      const resolved = resolve(projectRoot, p);
      if (!isPathSafe(projectRoot, resolved)) {
        throw new ConfigError(`Unsafe path in allowedPaths: ${p}`);
      }
    }
  }

  return permissions;
}

async function validatePluginsFile(
  projectRoot: string,
  realDotPath: string,
  filename: string,
): Promise<IProjectPlugins | null> {
  const filePath = join(realDotPath, filename);

  // Step 5: existence check
  if (!existsSync(filePath)) {
    return null;
  }

  // Step 6: per-file symlink defense + size check
  let realFilePath: string;
  try {
    realFilePath = realpathSync(filePath);
  } catch (err) {
    throw new SecurityError(
      `Failed to resolve real path for ${filename}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!isPathSafe(projectRoot, realFilePath)) {
    throw new SecurityError(`${filename} resolves outside project root (possible symlink attack)`);
  }
  const fileSize = statSync(realFilePath).size;
  if (fileSize >= MAX_CONFIG_SIZE) {
    throw new ConfigError(`Project config file exceeds 1MB limit: ${filename}`);
  }

  // Step 7: JSON parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(realFilePath, "utf-8"));
  } catch (err) {
    throw new ConfigError(
      `Invalid JSON in project config: ${filename}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Step 8: Zod schema validation — routed through Plan49 C49-M3 schema-drift policy.
  // Same historical-contract rationale as validatePermissionsFile above.
  const policy = applySchemaDriftPolicy(ProjectPluginsSchema, parsed, `${filename}`);
  if (!policy.ok) {
    throw new ConfigError(`Project config schema error in ${filename}: ${policy.error}`);
  }
  const plugins = policy.data as IProjectPlugins;

  // Step 9: Semantic validation — validate plugin path entries
  for (const plugin of plugins.plugins) {
    if (plugin.path) {
      // Per-file symlink defense for plugin paths
      if (!isPathSafe(projectRoot, plugin.path)) {
        throw new ConfigError(`Unsafe plugin path: ${plugin.path}`);
      }
      // Attempt realpathSync on the plugin path (may not exist yet — only check if it does)
      const absPluginPath = resolve(projectRoot, plugin.path);
      if (existsSync(absPluginPath)) {
        let realPluginPath: string;
        try {
          realPluginPath = realpathSync(absPluginPath);
        } catch {
          throw new ConfigError(`Failed to resolve plugin path: ${plugin.path}`);
        }
        if (!isPathSafe(projectRoot, realPluginPath)) {
          throw new ConfigError(`Unsafe plugin path (symlink): ${plugin.path}`);
        }
      }
    }
  }

  return plugins;
}
