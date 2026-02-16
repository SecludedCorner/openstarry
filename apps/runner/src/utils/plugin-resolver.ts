/**
 * Plugin resolution logic - extracted from bin.ts for testability.
 *
 * Supports path-based, system directory, and package-name-based resolution.
 */

import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import type { IAgentConfig, IPlugin } from "@openstarry/sdk";
import type { SystemConfig } from "../bootstrap.js";
import { SYSTEM_CONFIG_PATH } from "../bootstrap.js";

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
 */
export async function resolvePlugins(
  config: IAgentConfig,
  verbose = false
): Promise<PluginResolutionResult> {
  const plugins: IPlugin[] = [];
  const errors: PluginResolutionError[] = [];

  for (const ref of config.plugins) {
    try {
      const plugin = await resolvePlugin(ref);
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
async function resolvePlugin(ref: { name: string; path?: string }): Promise<IPlugin> {
  // Strategy 1: Explicit path
  if (ref.path) {
    const absolutePath = resolve(ref.path);
    const fileUrl = pathToFileURL(absolutePath).href;
    const mod = await import(fileUrl) as Record<string, unknown>;
    const factory = (mod.default ?? mod.createPlugin ?? findFactory(mod)) as
      | ((opts?: unknown) => IPlugin)
      | undefined;
    if (typeof factory === "function") {
      const plugin = factory();
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
      const plugin = factory();
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
        const plugin = factory();
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
 * Find plugin entry path in system plugin directories.
 *
 * Algorithm:
 * 1. Check cache first (process-lifetime)
 * 2. Read system config to get pluginSearchPaths
 * 3. For each search path:
 *    a. Scan directory for subdirectories
 *    b. Read package.json in each subdirectory
 *    c. If package.json.name matches packageName, return entry path
 * 4. If not found in any search path, return null
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
    const config = await readSystemConfig();

    for (const searchPath of config.pluginSearchPaths) {
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
