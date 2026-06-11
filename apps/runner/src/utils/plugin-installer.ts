/**
 * Plugin Installer — Core install/uninstall logic for plugin management.
 *
 * Resolution strategy:
 *   1. Workspace-first: resolve from pnpm workspace (node_modules)
 *   2. npm fallback: `npm pack` + extract to ~/.openstarry/plugins/installed/
 */

import { existsSync, readdirSync } from "node:fs";
import { mkdir, cp, rm, readFile, mkdtemp } from "node:fs/promises";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { PLUGINS_DIR } from "../bootstrap.js";
import { getCatalogEntry, getAllCatalogEntries, type CatalogEntry } from "./plugin-catalog.js";
import { addToLock, removeFromLock, isInstalled, LOCK_FILE_PATH } from "./plugin-lock.js";
import { syncPlugin } from "./plugin-scanner.js";

export interface InstallOptions {
  force?: boolean;
  verbose?: boolean;
  lockPath?: string;
  /**
   * Override the plugin install target directory. Defaults to `~/.openstarry/plugins/installed/`.
   * Test isolation: pass a tempDir-scoped path so parallel test files do not race on the
   * single user-global directory (Plan49 C49-M1 root cause).
   */
  installedDir?: string;
}

export interface InstallResult {
  installed: string[];
  skipped: string[];
  failed: Array<{ name: string; error: string }>;
}

/** Default install directory. Overridable via `InstallOptions.installedDir`. */
export const DEFAULT_INSTALLED_DIR = join(PLUGINS_DIR, "installed");

/**
 * Resolve the effective lock path and install dir for a call. The ladder is:
 *   option → process.env → module default.
 * Plan49 C49-M1: keeps the 3 call-sites (`installPlugin`, `uninstallPlugin`,
 * `installAll`) in sync without copy-pasting the env-var fallback.
 */
function resolveInstallPaths(options: InstallOptions): {
  lockPath: string;
  installedDir: string;
} {
  return {
    lockPath: options.lockPath ?? process.env.OPENSTARRY_LOCK_PATH ?? LOCK_FILE_PATH,
    installedDir:
      options.installedDir ?? process.env.OPENSTARRY_INSTALL_DIR ?? DEFAULT_INSTALLED_DIR,
  };
}

/**
 * Derive the directory name from a scoped package name.
 * "@openstarry-plugin/foo" → "foo"
 */
function dirNameFromPackage(packageName: string): string {
  const parts = packageName.split("/");
  return parts[parts.length - 1];
}

/**
 * Try to resolve a package from the workspace (node_modules).
 * Returns the resolved directory path, or null if not found.
 */
function resolveFromWorkspace(packageName: string): string | null {
  try {
    // Use require.resolve to find the package entry point
    const resolved = execSync(
      `node -e "try { const r = require.resolve('${packageName}/package.json'); console.log(r); } catch { process.exit(1); }"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 10000 },
    ).trim();

    if (resolved && existsSync(resolved)) {
      return dirname(resolved);
    }
  } catch {
    // Not found in workspace
  }
  return null;
}

/**
 * Install a single plugin by package name.
 */
export async function installPlugin(
  name: string,
  options: InstallOptions = {},
): Promise<{ success: boolean; error?: string }> {
  const { force = false, verbose = false } = options;
  const { lockPath: effectiveLockPath, installedDir: effectiveInstalledDir } =
    resolveInstallPaths(options);

  // Check if already installed (skip unless --force)
  if (!force && (await isInstalled(name, effectiveLockPath))) {
    if (verbose) {
      console.log(`  [skip] ${name} (already installed)`);
    }
    return { success: true };
  }

  // Look up version from catalog (for lock file record)
  const entry = getCatalogEntry(name);
  const version = entry?.version ?? "0.0.0";

  const dirName = dirNameFromPackage(name);
  const targetDir = join(effectiveInstalledDir, dirName);

  // Ensure installed directory exists
  await mkdir(effectiveInstalledDir, { recursive: true });

  // Strategy 1: Workspace resolution
  const workspacePath = resolveFromWorkspace(name);
  if (workspacePath) {
    if (verbose) {
      console.log(`  [workspace] ${name} → ${workspacePath}`);
    }
    // Copy from workspace using syncPlugin (excludes node_modules, sanitizes deps)
    await syncPlugin(workspacePath, targetDir, { skipDeps: true, verbose });
    await addToLock(name, version, effectiveLockPath);
    return { success: true };
  }

  // Strategy 2: npm pack fallback
  try {
    if (verbose) {
      console.log(`  [npm] Fetching ${name}...`);
    }
    // mkdtemp gives a unique dir without hand-rolling a PID/time/random suffix —
    // prevents same-millisecond collisions across parallel vitest threads (Plan49 C49-M1b).
    const tmpDir = await mkdtemp(join(tmpdir(), "openstarry-install-"));

    try {
      execSync(`npm pack ${name} --pack-destination "${tmpDir}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        cwd: tmpDir,
        timeout: 30000,
      });

      const files = readdirSync(tmpDir).filter(f => f.endsWith(".tgz"));
      if (files.length === 0) {
        return { success: false, error: "npm pack produced no tarball" };
      }

      // Extract tarball
      const tarball = join(tmpDir, files[0]);
      const extractDir = join(tmpDir, "extracted");
      await mkdir(extractDir, { recursive: true });
      execSync(`tar xzf "${tarball}" -C "${extractDir}"`, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Copy the extracted "package" directory to target
      const packageDir = join(extractDir, "package");
      if (!existsSync(packageDir)) {
        return { success: false, error: "Extracted tarball has no package directory" };
      }

      if (existsSync(targetDir)) {
        await rm(targetDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      }
      try {
        await cp(packageDir, targetDir, { recursive: true, dereference: true });
      } catch (cpErr) {
        if (process.platform === "win32") {
          await rm(targetDir, { recursive: true, force: true }).catch(() => {});
          await cp(packageDir, targetDir, { recursive: true });
        } else {
          throw cpErr;
        }
      }
      await addToLock(name, version, effectiveLockPath);
      return { success: true };
    } finally {
      // Clean up temp directory
      if (existsSync(tmpDir)) {
        await rm(tmpDir, { recursive: true, force: true });
      }
    }
  } catch (err) {
    return {
      success: false,
      error: `Failed to install ${name}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Uninstall a plugin by package name.
 */
export async function uninstallPlugin(
  name: string,
  options: InstallOptions = {},
): Promise<{ success: boolean; error?: string }> {
  const { verbose = false } = options;
  const { lockPath: effectiveLockPath, installedDir: effectiveInstalledDir } =
    resolveInstallPaths(options);

  const dirName = dirNameFromPackage(name);
  const targetDir = join(effectiveInstalledDir, dirName);

  // Remove from installed directory
  if (existsSync(targetDir)) {
    await rm(targetDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    if (verbose) {
      console.log(`  [removed] ${targetDir}`);
    }
  }

  // Remove from lock file
  await removeFromLock(name, effectiveLockPath);

  return { success: true };
}

/**
 * Install all plugins from the catalog.
 */
export async function installAll(options: InstallOptions = {}): Promise<InstallResult> {
  const entries = getAllCatalogEntries();
  const result: InstallResult = { installed: [], skipped: [], failed: [] };

  const { force = false } = options;
  const { lockPath: effectiveLockPath } = resolveInstallPaths(options);

  for (const entry of entries) {
    if (!force && (await isInstalled(entry.name, effectiveLockPath))) {
      result.skipped.push(entry.name);
      if (options.verbose) {
        console.log(`  [skip] ${entry.name} (already installed)`);
      }
      continue;
    }

    const installResult = await installPlugin(entry.name, options);
    if (installResult.success) {
      result.installed.push(entry.name);
      console.log(`  [installed] ${entry.name}`);
    } else {
      result.failed.push({ name: entry.name, error: installResult.error ?? "Unknown error" });
      console.error(`  [failed] ${entry.name}: ${installResult.error}`);
    }
  }

  return result;
}
