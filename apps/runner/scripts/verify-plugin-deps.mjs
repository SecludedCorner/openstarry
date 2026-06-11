/**
 * CC-1: Plugin Dependency CI Check (K-2 HIGH)
 *
 * Verifies that every @openstarry-plugin/* workspace package is listed in
 * apps/runner/package.json dependencies. Run as a pre-publish guard.
 *
 * Usage: node apps/runner/scripts/verify-plugin-deps.mjs
 * Exit:  0 = all plugins present, 1 = missing plugins found
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve paths relative to this script (apps/runner/scripts/)
const RUNNER_PKG_PATH = resolve(__dirname, '..', 'package.json');
const WORKSPACE_ROOT = resolve(__dirname, '..', '..', '..'); // agent_dev/openstarry/
const PLUGIN_DIR = resolve(WORKSPACE_ROOT, '..', 'openstarry_plugin'); // agent_dev/openstarry_plugin/

async function getRunnerDependencies() {
  const raw = await readFile(RUNNER_PKG_PATH, 'utf-8');
  const pkg = JSON.parse(raw);
  return new Set(Object.keys(pkg.dependencies ?? {}));
}

async function getWorkspacePluginNames() {
  if (!existsSync(PLUGIN_DIR)) {
    console.error(`[warn] Plugin directory not found: ${PLUGIN_DIR}`);
    return [];
  }

  const entries = await readdir(PLUGIN_DIR, { withFileTypes: true });
  const pluginNames = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(PLUGIN_DIR, entry.name, 'package.json');
    if (!existsSync(pkgPath)) continue;

    try {
      const raw = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw);
      if (typeof pkg.name === 'string' && pkg.name.startsWith('@openstarry-plugin/')) {
        pluginNames.push(pkg.name);
      }
    } catch {
      // Skip unparseable package.json
    }
  }

  return pluginNames;
}

async function main() {
  const [runnerDeps, workspacePlugins] = await Promise.all([
    getRunnerDependencies(),
    getWorkspacePluginNames(),
  ]);

  const missing = workspacePlugins.filter((name) => !runnerDeps.has(name));

  if (missing.length > 0) {
    console.error(`[FAIL] verify-plugin-deps: ${missing.length} plugin(s) missing from apps/runner/package.json:`);
    for (const name of missing) {
      console.error(`  - ${name}`);
    }
    process.exit(1);
  }

  console.log(`[OK] verify-plugin-deps: ${workspacePlugins.length} plugins verified`);
}

main().catch((err) => {
  console.error(`[ERROR] verify-plugin-deps: unexpected error: ${err.message}`);
  process.exit(1);
});
