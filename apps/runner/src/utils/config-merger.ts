/**
 * Config merge logic for project-level .openstarry/ overrides.
 * Plan34: Project-Level Config Support.
 *
 * Implements restrict-only merge semantics:
 *   Security-ceiling: intersection / Math.min (stricter wins)
 *   Security-floor:   Math.max (higher floor = stricter)
 *   Neutral:          project value overrides system value
 */

import { resolve, sep } from "node:path";
import type { IAgentConfig } from "@openstarry/sdk";
import type { IProjectConfig, IProjectPermissions, IProjectPlugins } from "@openstarry/sdk";
import { ConfigError } from "./permission-validator.js";

/**
 * Merge project-level config files into the system-level IAgentConfig.
 *
 * Merge semantics per field category:
 *   Security-ceiling: intersection / Math.min (stricter wins)
 *   Security-floor:   Math.max (higher floor = stricter)
 *   Neutral:          project value overrides system value
 *
 * CRITICAL ORDERING: mergeConfigs() must be called BEFORE the
 * allowedPaths cwd-default injection in start.ts.
 *
 * @param systemConfig - The agent config loaded from agent.json / --config flag.
 * @param projectConfig - Parsed .openstarry/config.json (may be null if absent).
 * @param projectPermissions - Parsed .openstarry/permissions.json (may be null if absent).
 * @param projectPlugins - Parsed .openstarry/plugins.json (may be null if absent).
 * @param projectRoot - Absolute path to project root (used for resolving relative allowedPaths).
 * @returns A new IAgentConfig reflecting the merged result. Input objects are not mutated.
 * @throws ConfigError if the merged allowedPaths result is an empty set
 *         when the system config had a non-empty allowedPaths.
 */
export function mergeConfigs(
  systemConfig: IAgentConfig,
  projectConfig: IProjectConfig | null,
  projectPermissions: IProjectPermissions | null,
  projectPlugins: IProjectPlugins | null,
  projectRoot: string,
): IAgentConfig {
  // Deep clone to avoid mutating input
  const result: IAgentConfig = JSON.parse(JSON.stringify(systemConfig)) as IAgentConfig;

  // --- Neutral fields from projectConfig ---
  if (projectConfig) {
    if (projectConfig.identity) {
      if (projectConfig.identity.name !== undefined) {
        result.identity.name = projectConfig.identity.name;
      }
      if (projectConfig.identity.description !== undefined) {
        result.identity.description = projectConfig.identity.description;
      }
      if (projectConfig.identity.version !== undefined) {
        result.identity.version = projectConfig.identity.version;
      }
    }
    if (projectConfig.cognition) {
      if (projectConfig.cognition.temperature !== undefined) {
        result.cognition.temperature = projectConfig.cognition.temperature;
      }
      // cognition.maxRetries does not exist in current CognitionConfig — skip silently
      // (forward-compatibility: field accepted in schema but merge target absent)
    }
    if (projectConfig.memory) {
      // memory.strategy does not exist in current MemoryConfig — skip silently
      // (forward-compatibility: field accepted in schema but merge target absent)
    }
  }

  // --- Security-ceiling + security-floor fields from projectPermissions ---
  if (projectPermissions) {
    // allowedPaths: containment intersection
    if (projectPermissions.allowedPaths !== undefined) {
      const systemPaths = systemConfig.capabilities.allowedPaths;
      const projectPaths = projectPermissions.allowedPaths.map(p => resolve(projectRoot, p));

      if (!systemPaths || systemPaths.length === 0) {
        // System has no allowedPaths — use project paths directly as ceiling
        result.capabilities.allowedPaths = projectPaths;
      } else {
        // Containment intersection: retain only project paths that are sub-paths of some system path
        const intersection = projectPaths.filter(p =>
          systemPaths.some(sp => p === sp || p.startsWith(sp + sep))
        );
        if (intersection.length === 0) {
          throw new ConfigError("Project permissions produce empty allowedPaths intersection");
        }
        result.capabilities.allowedPaths = intersection;
      }
    }

    // allowedTools: set intersection (exact match)
    if (projectPermissions.allowedTools !== undefined) {
      const systemTools = systemConfig.capabilities.tools;
      if (!systemTools || systemTools.length === 0) {
        result.capabilities.tools = projectPermissions.allowedTools;
      } else {
        result.capabilities.tools = systemTools.filter(t =>
          projectPermissions.allowedTools!.includes(t)
        );
      }
    }

    // deniedTools: apply as filter against capabilities.tools
    if (projectPermissions.deniedTools !== undefined && projectPermissions.deniedTools.length > 0) {
      result.capabilities.tools = result.capabilities.tools.filter(
        t => !projectPermissions.deniedTools!.includes(t)
      );
    }

    // SEC-002: warn if tools list is empty after intersection + deniedTools filtering
    if (result.capabilities.tools.length === 0) {
      console.warn("[cli] WARNING: Project permissions produce empty tools list — agent will have no tool access");
    }

    // maxConcurrentTools: Math.min
    if (projectPermissions.maxConcurrentTools !== undefined) {
      if (!result.policy) {
        result.policy = {};
      }
      result.policy.maxConcurrentTools = result.policy.maxConcurrentTools === undefined
        ? projectPermissions.maxConcurrentTools
        : Math.min(result.policy.maxConcurrentTools, projectPermissions.maxConcurrentTools);
    }

    // maxTokens: Math.min (cognition.maxTokens)
    if (projectPermissions.maxTokens !== undefined) {
      result.cognition.maxTokens = result.cognition.maxTokens === undefined
        ? projectPermissions.maxTokens
        : Math.min(result.cognition.maxTokens, projectPermissions.maxTokens);
    }

    // maxTokenUsage: Math.min (safety.maxTokenUsage)
    if (projectPermissions.maxTokenUsage !== undefined) {
      const newMaxTokenUsage = result.safety?.maxTokenUsage === undefined
        ? projectPermissions.maxTokenUsage
        : Math.min(result.safety.maxTokenUsage, projectPermissions.maxTokenUsage);
      result.safety = { ...result.safety, maxTokenUsage: newMaxTokenUsage };
    }

    // confidenceFloor: Math.max (Plan33 top-level field)
    if (projectPermissions.confidenceFloor !== undefined) {
      result.confidenceFloor = result.confidenceFloor === undefined
        ? projectPermissions.confidenceFloor
        : Math.max(result.confidenceFloor, projectPermissions.confidenceFloor);
    }

    // safetyMinimumGear: Math.max — field does not exist in SafetyMonitorConfig currently
    // Accept from project config, skip merge if target field is absent (forward compatibility)
    if (projectPermissions.safetyMinimumGear !== undefined) {
      // safety.minimumGear does not exist in current SafetyMonitorConfig — skip silently
    }
  }

  // --- Plugin list override (KD-2) ---
  if (projectPlugins) {
    // Completely replace the system plugin list
    result.plugins = projectPlugins.plugins.map(ref => ({
      name: ref.name,
      ...(ref.path !== undefined ? { path: ref.path } : {}),
      ...(ref.config !== undefined ? { config: ref.config } : {}),
      ...(ref.criticality !== undefined ? { criticality: ref.criticality } : {}),
    }));
  }

  return result;
}
