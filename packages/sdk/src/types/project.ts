/**
 * Project-level configuration types for .openstarry/ directory.
 * Plan34: Project-Level Config Support.
 *
 * All fields are optional — any combination of the three files may be absent.
 * Absent files produce no-op merge behavior (same as v0.33 semantics).
 */

/**
 * IProjectConfig — contents of .openstarry/config.json.
 *
 * Contains neutral (non-security) agent configuration overrides.
 * If security-ceiling or security-floor fields are detected here,
 * the validator MUST emit a WARN and route them through intersection/max
 * merge before discarding them from the neutral-field merge path.
 */
export interface IProjectConfig {
  /** Partial identity override (neutral — project override semantics). */
  identity?: {
    name?: string;
    description?: string;
    version?: string;
  };
  /** Partial cognition override (neutral fields only). */
  cognition?: {
    temperature?: number;
    maxRetries?: number;
  };
  /** Partial memory override (neutral — project override semantics). */
  memory?: {
    strategy?: string;
  };
}

/**
 * IProjectPermissions — contents of .openstarry/permissions.json.
 *
 * Contains all security restrictions. All fields apply restrict-only merge
 * semantics (security-ceiling fields use intersection; security-floor fields
 * use max). Absent fields perform no merge effect.
 */
export interface IProjectPermissions {
  /**
   * Restrict allowed filesystem paths to this subset.
   * Security-ceiling: merged via intersection with system allowedPaths.
   * Relative paths are resolved relative to projectRoot before intersection.
   */
  allowedPaths?: string[];
  /**
   * Restrict allowed tools to this subset.
   * Security-ceiling: merged via intersection with system tools list.
   */
  allowedTools?: string[];
  /**
   * Extend denied tools list.
   * Security-ceiling: merged via union (broader denial = stricter).
   */
  deniedTools?: string[];
  /**
   * Restrict max concurrent tools.
   * Security-ceiling: merged via Math.min (lower value = stricter).
   */
  maxConcurrentTools?: number;
  /**
   * Restrict max tokens.
   * Security-ceiling: merged via Math.min (lower value = stricter).
   */
  maxTokens?: number;
  /**
   * Restrict max token usage (safety.maxTokenUsage).
   * Security-ceiling: merged via Math.min.
   */
  maxTokenUsage?: number;
  /**
   * Raise confidence floor.
   * Security-floor: merged via Math.max (higher floor = stricter).
   */
  confidenceFloor?: number;
  /**
   * Raise minimum safety gear.
   * Security-floor: merged via Math.max (higher gear = stricter).
   */
  safetyMinimumGear?: number;
}

/**
 * IProjectPlugins — contents of .openstarry/plugins.json.
 *
 * When present, completely replaces the agent-config plugin list (KD-2).
 * Plugin path references are validated with isPathSafe() before use.
 */
export interface IProjectPlugins {
  plugins: IProjectPluginRef[];
}

/**
 * IProjectPluginRef — a plugin reference in .openstarry/plugins.json.
 * Structurally compatible with PluginRef from packages/sdk/src/types/agent.ts.
 */
export interface IProjectPluginRef {
  name: string;
  path?: string;
  config?: Record<string, unknown>;
  /**
   * Plugin criticality level (Plan33 compatibility).
   * Project-level plugins MAY declare criticality.
   * If absent, defaults to "optional-degraded" for project-level plugins.
   */
  criticality?: "required" | "optional-degraded" | "optional-no-effect";
}

/**
 * IProjectContext — the resolved project context after detection.
 * Produced by findProjectRoot() and consumed by loadProjectConfig().
 */
export interface IProjectContext {
  /** Absolute path to the project root directory (not yet symlink-resolved; resolution occurs in validateProjectConfig Steps 3-4). */
  projectRoot: string;
  /** Absolute path to the .openstarry/ directory (not yet symlink-resolved; resolution occurs in validateProjectConfig Steps 3-4). */
  dotOpenstarryPath: string;
}
