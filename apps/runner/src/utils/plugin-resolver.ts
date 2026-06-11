/**
 * Plugin resolution logic - extracted from bin.ts for testability.
 *
 * Supports path-based, system directory, and package-name-based resolution.
 */

import { resolve, join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import type { IAgentConfig, IPlugin } from "@openstarry/sdk";
import type { SystemConfig } from "../bootstrap.js";
import { SYSTEM_CONFIG_PATH } from "../bootstrap.js";
import { isPathSafe } from "./permission-validator.js";

export interface PluginResolutionError {
  pluginName: string;
  error: string;
  strategy: "path" | "system" | "package";
}

export interface PluginResolutionResult {
  plugins: IPlugin[];
  errors: PluginResolutionError[];
}

// In-memory cache for system directory plugin resolution (process-lifetime)
const systemPluginCache = new Map<string, string | null>();

/**
 * Resolve all plugins from agent configuration.
 *
 * Resolution strategies (per plugin ref):
 *   1. If ref.path exists → dynamic import from file path
 *   2. Otherwise → dynamic import by package name
 *
 * Errors are accumulated (don't fail on first error).
 *
 * @param config - Agent configuration with plugin list.
 * @param verbose - Log each loaded plugin name.
 * @param projectRoot - Optional project root for plugin path safety checks (Plan34 Wave 2).
 *   When provided and a PluginRef contains a path field, isPathSafe(projectRoot, ref.path)
 *   must pass before the path is resolved. If isPathSafe fails, the plugin is treated
 *   as a load error (accumulated, not fatal).
 */
export async function resolvePlugins(
  config: IAgentConfig,
  verbose = false,
  projectRoot?: string | null,
): Promise<PluginResolutionResult> {
  const plugins: IPlugin[] = [];
  const errors: PluginResolutionError[] = [];

  for (const ref of config.plugins) {
    try {
      const plugin = await resolvePlugin(ref, projectRoot ?? null);
      plugins.push(plugin);
      if (verbose) {
        console.log(`[plugin] Loaded: ${ref.name}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push({
        pluginName: ref.name,
        error: errorMsg,
        strategy: ref.path ? "path" : "package",
      });
      console.error(`[plugin] Failed to load ${ref.name}: ${errorMsg}`);
    }
  }

  return { plugins, errors };
}

/**
 * Resolve a single plugin from reference.
 *
 * Resolution order:
 * 1. Explicit path (if ref.path exists)
 * 2. Package name (workspace / node_modules — preferred)
 * 3. System directory (fallback for standalone daemon)
 */
async function resolvePlugin(ref: { name: string; path?: string; config?: Record<string, unknown> }, projectRoot: string | null): Promise<IPlugin> {
  // Strategy 1: Explicit path
  if (ref.path) {
    // Plan34 Wave 2: validate path is within project root when projectRoot is provided
    // SEC-001 fix: resolve path against projectRoot (not CWD) to ensure the path
    // that passes isPathSafe() is the same path that gets loaded via import().
    const absolutePath = projectRoot !== null ? resolve(projectRoot, ref.path) : resolve(ref.path);
    if (projectRoot !== null) {
      if (!isPathSafe(projectRoot, absolutePath)) {
        throw new Error(`Plugin path '${ref.path}' is not within project root '${projectRoot}'`);
      }
    }
    const fileUrl = pathToFileURL(absolutePath).href;
    const mod = await import(fileUrl) as Record<string, unknown>;
    const factory = (mod.default ?? mod.createPlugin ?? findFactory(mod)) as
      | ((opts?: unknown) => IPlugin)
      | undefined;
    if (typeof factory === "function") {
      const plugin = factory(ref.config);
      (plugin as unknown as Record<string, unknown>)._resolvedModulePath = fileUrl;
      return plugin;
    }
    throw new Error(`Plugin at "${ref.path}" does not export a factory function`);
  }

  // Strategy 2: Package name (workspace / node_modules — preferred)
  try {
    const mod = await import(ref.name) as Record<string, unknown>;
    const factory = (mod.default ?? mod.createPlugin ?? findFactory(mod)) as
      | ((opts?: unknown) => IPlugin)
      | undefined;
    if (typeof factory === "function") {
      const plugin = factory(ref.config);
      // Resolve the absolute file path so sandbox workers can import it directly
      try {
        // import.meta.resolve uses same ESM algorithm as import() — most reliable
        (plugin as unknown as Record<string, unknown>)._resolvedModulePath =
          (import.meta as ImportMeta & { resolve(s: string): string }).resolve(ref.name);
      } catch {
        try {
          const require = createRequire(import.meta.url);
          const resolved = require.resolve(ref.name);
          (plugin as unknown as Record<string, unknown>)._resolvedModulePath = pathToFileURL(resolved).href;
        } catch {
          // Non-critical: sandbox will fall back to bare name
        }
      }
      return plugin;
    }
    throw new Error(`Package "${ref.name}" does not export a factory function`);
  } catch {
    // Not found in workspace / node_modules — fall through to system directory
  }

  // Strategy 3: System directory (fallback for standalone daemon)
  const systemPath = await findInSystemDirectory(ref.name);
  if (systemPath) {
    try {
      const fileUrl = pathToFileURL(systemPath).href;
      const mod = await import(fileUrl) as Record<string, unknown>;
      const factory = (mod.default ?? mod.createPlugin ?? findFactory(mod)) as
        | ((opts?: unknown) => IPlugin)
        | undefined;
      if (typeof factory === "function") {
        const plugin = factory(ref.config);
        (plugin as unknown as Record<string, unknown>)._resolvedModulePath = fileUrl;
        return plugin;
      }
      throw new Error(`Plugin at "${systemPath}" does not export a factory function`);
    } catch (err) {
      throw new Error(
        `Failed to load plugin from system directory "${systemPath}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  throw new Error(
    `Plugin "${ref.name}" not found in workspace or system directory`
  );
}

/**
 * Default plugin search paths derived from the runner's own location.
 *
 * FIX-2026-06-11 (provider-by-name resolution): in the documented monorepo
 * layout (README "Project Structure"), `openstarry_plugin/` sits as a SIBLING
 * of the `openstarry/` monorepo root. Plugins not listed in the runner's
 * package.json (e.g. provider-claude-cli) previously failed by-name
 * resolution unless the user discovered the undocumented per-plugin `path`
 * field. The sibling directory is now a built-in search path — no
 * ~/.openstarry/config.json required. Non-monorepo installs are unaffected
 * (the path simply does not exist and is skipped).
 *
 * Location math: this module lives at <root>/apps/runner/{src|dist}/utils/,
 * so the monorepo root is 4 levels up and the sibling is `../openstarry_plugin`.
 */
export function getDefaultPluginSearchPaths(): string[] {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const monorepoRoot = resolve(here, "../../../..");
    return [resolve(monorepoRoot, "../openstarry_plugin")];
  } catch {
    return [];
  }
}

/**
 * Find plugin entry path in system plugin directories.
 *
 * Algorithm:
 * 1. Check cache first (process-lifetime)
 * 2. Read system config to get pluginSearchPaths (optional — defaults still
 *    apply when the config is absent; FIX-2026-06-11)
 * 3. Append built-in default search paths (monorepo sibling openstarry_plugin/)
 * 4. For each search path:
 *    a. Scan directory for subdirectories
 *    b. Read package.json in each subdirectory
 *    c. If package.json.name matches packageName, return entry path
 * 5. If not found in any search path, return null
 *
 * @param packageName - Package name to search (e.g., "@openstarry-plugin/standard-function-fs")
 * @returns Absolute path to plugin entry file, or null if not found
 */
async function findInSystemDirectory(packageName: string): Promise<string | null> {
  // Check cache first
  if (systemPluginCache.has(packageName)) {
    return systemPluginCache.get(packageName)!;
  }

  try {
    let configuredPaths: string[] = [];
    try {
      configuredPaths = (await readSystemConfig()).pluginSearchPaths;
    } catch {
      // System config absent — built-in defaults below still apply (FIX-2026-06-11).
    }
    const searchPaths = [...configuredPaths, ...getDefaultPluginSearchPaths()];

    for (const searchPath of searchPaths) {
      if (!existsSync(searchPath)) {
        continue;
      }

      let entries: string[];
      try {
        entries = await readdir(searchPath);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const pluginDir = join(searchPath, entry);

        // Check if it's a directory
        try {
          const stat = await readdir(pluginDir).catch(() => null);
          if (stat === null) continue;
        } catch {
          continue;
        }

        // Read package.json
        const pkgPath = join(pluginDir, "package.json");
        if (!existsSync(pkgPath)) {
          continue;
        }

        try {
          const pkgContent = await readFile(pkgPath, "utf-8");
          const pkg = JSON.parse(pkgContent) as { name?: string; main?: string };

          if (pkg.name === packageName) {
            const mainEntry = pkg.main || "dist/index.js";
            const entryPath = resolve(join(pluginDir, mainEntry));

            // Cache the result
            systemPluginCache.set(packageName, entryPath);
            return entryPath;
          }
        } catch {
          continue;
        }
      }
    }
  } catch (err) {
    // If we can't read system config, fall back to null
  }

  // Cache negative result
  systemPluginCache.set(packageName, null);
  return null;
}

/**
 * Read system configuration from ~/.openstarry/config.json.
 *
 * @returns System configuration with pluginSearchPaths
 */
async function readSystemConfig(): Promise<SystemConfig> {
  if (!existsSync(SYSTEM_CONFIG_PATH)) {
    throw new Error(`System config not found at ${SYSTEM_CONFIG_PATH}`);
  }

  const configContent = await readFile(SYSTEM_CONFIG_PATH, "utf-8");
  return JSON.parse(configContent) as SystemConfig;
}

/**
 * Find a factory function in module exports by convention (create*Plugin).
 */
function findFactory(mod: Record<string, unknown>): ((opts?: unknown) => IPlugin) | undefined {
  for (const key of Object.keys(mod)) {
    if (/^create\w+Plugin$/.test(key) && typeof mod[key] === "function") {
      return mod[key] as (opts?: unknown) => IPlugin;
    }
  }
  return undefined;
}
