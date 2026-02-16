/**
 * Cross-platform clean script — works on Windows + Linux even when node_modules is missing.
 * Deletes: dist/, *.tsbuildinfo, node_modules/, pnpm-lock.yaml
 * Covers both openstarry monorepo and ../openstarry_plugin/*
 */
import { rmSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PLUGIN_ROOT = resolve(ROOT, "..", "openstarry_plugin");

const GLOB_TARGETS = ["dist", "node_modules"];
const FILE_TARGETS = ["pnpm-lock.yaml"];
const EXT_TARGETS = [".tsbuildinfo"];

let removed = 0;

function rm(target) {
  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    removed++;
  } catch {
    // Ignore — file may not exist or be locked
  }
}

function cleanDir(base) {
  // Clean top-level targets
  for (const name of GLOB_TARGETS) {
    rm(join(base, name));
  }
  for (const name of FILE_TARGETS) {
    rm(join(base, name));
  }

  // Clean tsbuildinfo at top level
  try {
    for (const f of readdirSync(base)) {
      if (EXT_TARGETS.some((ext) => f.endsWith(ext))) {
        rm(join(base, f));
      }
    }
  } catch {
    // Directory may not exist
  }

  // Recurse into subdirectories (packages/*, apps/*)
  try {
    for (const entry of readdirSync(base)) {
      const full = join(base, entry);
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;

      for (const name of GLOB_TARGETS) {
        rm(join(full, name));
      }
      // tsbuildinfo in subdirs
      try {
        for (const f of readdirSync(full)) {
          if (EXT_TARGETS.some((ext) => f.endsWith(ext))) {
            rm(join(full, f));
          }
        }
      } catch {}

      // One more level deep (packages/sdk/dist, apps/runner/dist, etc.)
      try {
        for (const sub of readdirSync(full)) {
          const subFull = join(full, sub);
          try {
            if (!statSync(subFull).isDirectory()) continue;
          } catch {
            continue;
          }
          if (sub === "node_modules" || sub === "dist" || sub === ".git") continue;

          for (const name of GLOB_TARGETS) {
            rm(join(subFull, name));
          }
          try {
            for (const f of readdirSync(subFull)) {
              if (EXT_TARGETS.some((ext) => f.endsWith(ext))) {
                rm(join(subFull, f));
              }
            }
          } catch {}
        }
      } catch {}
    }
  } catch {
    // Directory may not exist
  }
}

console.log("Cleaning openstarry monorepo...");
cleanDir(ROOT);

console.log("Cleaning openstarry_plugin...");
try {
  for (const plugin of readdirSync(PLUGIN_ROOT)) {
    const pluginDir = join(PLUGIN_ROOT, plugin);
    try {
      if (!statSync(pluginDir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const name of GLOB_TARGETS) {
      rm(join(pluginDir, name));
    }
    try {
      for (const f of readdirSync(pluginDir)) {
        if (EXT_TARGETS.some((ext) => f.endsWith(ext))) {
          rm(join(pluginDir, f));
        }
      }
    } catch {}
  }
} catch {
  console.log("  (openstarry_plugin not found, skipping)");
}

console.log(`Done. Removed ${removed} items.`);
