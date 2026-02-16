/**
 * Plugin Catalog — Load, query, and search the bundled plugin catalog.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface CatalogEntry {
  name: string;
  description: string;
  version: string;
  aggregates: string[];
  tags: string[];
}

export interface PluginCatalog {
  version: string;
  plugins: CatalogEntry[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let cachedCatalog: PluginCatalog | null = null;

/**
 * Load and parse the bundled plugin catalog JSON.
 * Result is cached for the process lifetime.
 */
export function loadCatalog(): PluginCatalog {
  if (cachedCatalog) {
    return cachedCatalog;
  }
  const catalogPath = resolve(__dirname, "../data/plugin-catalog.json");
  const raw = readFileSync(catalogPath, "utf-8");
  cachedCatalog = JSON.parse(raw) as PluginCatalog;
  return cachedCatalog;
}

/**
 * Search catalog entries by keyword against name, description, and tags.
 * Case-insensitive substring match.
 */
export function searchCatalog(query: string): CatalogEntry[] {
  const catalog = loadCatalog();
  const lowerQuery = query.toLowerCase();
  return catalog.plugins.filter(entry => {
    const haystack = [
      entry.name,
      entry.description,
      ...entry.tags,
      ...entry.aggregates,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(lowerQuery);
  });
}

/**
 * Get a single catalog entry by exact package name.
 */
export function getCatalogEntry(name: string): CatalogEntry | undefined {
  const catalog = loadCatalog();
  return catalog.plugins.find(entry => entry.name === name);
}

/**
 * Return all catalog entries.
 */
export function getAllCatalogEntries(): CatalogEntry[] {
  return loadCatalog().plugins;
}

/**
 * Reset the cache (used in tests).
 */
export function resetCatalogCache(): void {
  cachedCatalog = null;
}
