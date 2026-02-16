/**
 * Plugin Scanner — Utilities for discovering and syncing plugins from directories.
 *
 * Provides functionality to:
 * 1. Scan directories for valid OpenStarry plugins
 * 2. Validate plugin structure (package.json + dist/)
 * 3. Compare versions for incremental sync
 * 4. Perform directory-level sync operations
 */

import { readdir, readFile, writeFile, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

/**
 * Plugin metadata extracted from directory scan.
 */
export interface PluginInfo {
  /** Directory name (e.g., "standard-function-fs") */
  name: string;

  /** Package name from package.json (e.g., "@openstarry-plugin/standard-function-fs") */
  packageName: string;

  /** Version from package.json */
  version: string;

  /** Absolute path to plugin root directory */
  sourcePath: string;

  /** Relative path to entry file (from package.json.main, e.g., "dist/index.js") */
  mainEntry: string;
}

/**
 * Result of plugin directory scan operation.
 */
export interface PluginScanResult {
  /** List of valid plugins found */
  plugins: PluginInfo[];

  /** List of directories skipped (with reasons) */
  skipped: Array<{
    path: string;
    reason: "missing_package_json" | "invalid_package_name" | "missing_dist" | "malformed_json";
  }>;
}

/**
 * Scan a directory for valid OpenStarry plugins.
 *
 * Validation criteria:
 * 1. Directory contains package.json
 * 2. package.json has "name" field matching "@openstarry-plugin/*" or "openstarry-plugin-*"
 * 3. Directory contains dist/ with entry file (package.json.main, defaults to "dist/index.js")
 *
 * @param sourceDir - Absolute path to directory to scan
 * @returns Scan result with discovered plugins and skipped entries
 */
export async function scanPluginDirectory(sourceDir: string): Promise<PluginScanResult> {
  const result: PluginScanResult = {
    plugins: [],
    skipped: [],
  };

  let entries: string[];
  try {
    entries = await readdir(sourceDir);
  } catch (err) {
    throw new Error(`Failed to read directory ${sourceDir}: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const entry of entries) {
    const entryPath = join(sourceDir, entry);

    // Skip if not a directory
    try {
      const stat = await readdir(entryPath).catch(() => null);
      if (stat === null) continue;
    } catch {
      continue;
    }

    // Read package.json
    const pkgPath = join(entryPath, "package.json");
    if (!existsSync(pkgPath)) {
      result.skipped.push({
        path: entryPath,
        reason: "missing_package_json",
      });
      continue;
    }

    let pkg: { name?: string; version?: string; main?: string };
    try {
      const pkgContent = await readFile(pkgPath, "utf-8");
      pkg = JSON.parse(pkgContent);
    } catch (err) {
      result.skipped.push({
        path: entryPath,
        reason: "malformed_json",
      });
      continue;
    }

    // Validate package name
    const packageName = pkg.name;
    if (!packageName || (!packageName.startsWith("@openstarry-plugin/") && !packageName.startsWith("openstarry-plugin-"))) {
      result.skipped.push({
        path: entryPath,
        reason: "invalid_package_name",
      });
      continue;
    }

    // Determine entry file
    const mainEntry = pkg.main || "dist/index.js";
    const entryFilePath = join(entryPath, mainEntry);

    if (!existsSync(entryFilePath)) {
      result.skipped.push({
        path: entryPath,
        reason: "missing_dist",
      });
      continue;
    }

    // Valid plugin
    result.plugins.push({
      name: entry,
      packageName,
      version: pkg.version || "0.0.0",
      sourcePath: resolve(entryPath),
      mainEntry,
    });
  }

  return result;
}

/**
 * Determine if a plugin should be synced based on version comparison.
 *
 * Logic:
 * - If target doesn't exist → true
 * - If target package.json is missing or malformed → true
 * - If source version !== target version → true
 * - Otherwise → false
 *
 * @param sourcePath - Absolute path to source plugin directory
 * @param targetPath - Absolute path to target plugin directory
 * @returns true if sync is needed, false if already up-to-date
 */
export async function shouldSyncPlugin(
  sourcePath: string,
  targetPath: string,
): Promise<boolean> {
  // Check if target exists
  if (!existsSync(targetPath)) {
    return true;
  }

  // Compare versions
  try {
    const sourceVersion = await readPluginVersion(sourcePath);
    const targetVersion = await readPluginVersion(targetPath);
    return sourceVersion !== targetVersion;
  } catch (err) {
    // If we can't read target version (corrupted), sync
    return true;
  }
}

/** Options for syncPlugin. */
export interface SyncPluginOptions {
  /** Skip `npm install` for non-workspace production deps (default: false). */
  skipDeps?: boolean;
  /** Log verbose output (default: false). */
  verbose?: boolean;
}

/**
 * Copy plugin directory from source to target.
 *
 * - Removes target directory if exists (clean install)
 * - Excludes node_modules/ from copy
 * - Sanitizes package.json (removes workspace deps, devDependencies)
 * - Optionally runs `npm install --production` for remaining deps
 *
 * @param sourcePath - Absolute path to source plugin directory
 * @param targetPath - Absolute path to target plugin directory (parent must exist)
 * @param options - Sync options
 */
export async function syncPlugin(
  sourcePath: string,
  targetPath: string,
  options: SyncPluginOptions = {},
): Promise<void> {
  const { skipDeps = false, verbose = false } = options;

  // Remove existing target if it exists
  if (existsSync(targetPath)) {
    await rm(targetPath, { recursive: true, force: true });
  }

  // Copy source to target, excluding node_modules
  await copyPluginWithoutNodeModules(sourcePath, targetPath);

  // Sanitize package.json
  const sanitized = await sanitizePackageJson(targetPath);

  // Install non-workspace production deps if needed
  if (!skipDeps && sanitized && hasNonWorkspaceDependencies(sanitized)) {
    if (verbose) {
      console.log(`  [deps] Installing production deps for ${targetPath}`);
    }
    await installProductionDeps(targetPath, verbose);
  }
}

/**
 * Copy a plugin directory, excluding node_modules/.
 */
export async function copyPluginWithoutNodeModules(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await cp(sourcePath, targetPath, {
    recursive: true,
    filter: (src) => {
      // Exclude node_modules directories at any depth
      const relative = src.slice(sourcePath.length);
      // On Windows, normalize separators
      const normalized = relative.replace(/\\/g, "/");
      return !normalized.includes("/node_modules") && !normalized.endsWith("node_modules");
    },
  });
}

/**
 * Sanitize a copied plugin's package.json:
 * - Remove `workspace:*` and `link:` dependencies
 * - Remove `@openstarry/*` dependencies (internal, resolved at runtime)
 * - Remove devDependencies entirely
 *
 * Returns the sanitized dependencies (or null if no package.json found).
 */
export async function sanitizePackageJson(
  pluginPath: string,
): Promise<Record<string, string> | null> {
  const pkgPath = join(pluginPath, "package.json");
  if (!existsSync(pkgPath)) return null;

  try {
    const raw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as Record<string, unknown>;

    // Remove devDependencies
    delete pkg.devDependencies;

    // Sanitize dependencies
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const cleanDeps: Record<string, string> = {};

    for (const [name, version] of Object.entries(deps)) {
      // Skip workspace protocol deps
      if (typeof version === "string" && (version.startsWith("workspace:") || version.startsWith("link:"))) {
        continue;
      }
      // Skip internal @openstarry/* packages
      if (name.startsWith("@openstarry/")) {
        continue;
      }
      cleanDeps[name] = version;
    }

    pkg.dependencies = cleanDeps;

    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    return cleanDeps;
  } catch {
    return null;
  }
}

/**
 * Check if a sanitized dependencies object has any remaining (non-workspace) entries.
 */
export function hasNonWorkspaceDependencies(deps: Record<string, string>): boolean {
  return Object.keys(deps).length > 0;
}

/**
 * Run `npm install --production --ignore-scripts` in the plugin directory.
 * Failures are logged as warnings, never crash the process.
 */
export async function installProductionDeps(
  pluginPath: string,
  verbose = false,
): Promise<boolean> {
  try {
    execSync("npm install --production --ignore-scripts", {
      cwd: pluginPath,
      encoding: "utf-8",
      stdio: verbose ? "inherit" : ["pipe", "pipe", "pipe"],
      timeout: 60000,
    });
    return true;
  } catch (err) {
    console.warn(
      `[plugin-sync] Warning: npm install failed in ${pluginPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Read plugin version from package.json.
 *
 * @param pluginPath - Absolute path to plugin directory
 * @returns Version string (defaults to "0.0.0" if missing)
 * @throws If package.json doesn't exist or is malformed
 */
export async function readPluginVersion(pluginPath: string): Promise<string> {
  const pkgPath = join(pluginPath, "package.json");

  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found at ${pkgPath}`);
  }

  try {
    const pkgContent = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgContent) as { version?: string };
    return pkg.version || "0.0.0";
  } catch (err) {
    throw new Error(`Failed to read package.json at ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
