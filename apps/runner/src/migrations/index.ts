/**
 * Config migration registry — versioned JSON transforms.
 * NEW IN v0.33.0-alpha (Plan33 OQ-33-4).
 *
 * Each migration is a pure function: (config: unknown) => unknown.
 * Migrations are composable — v0.31→v0.33 runs both v0.31→v0.32 and v0.32→v0.33.
 */

export interface Migration {
  from: string;
  to: string;
  transform: (config: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * v0.32 → v0.33 migration.
 * - Adds criticality to context-sliding-window plugin entry.
 */
const v032_to_v033: Migration = {
  from: "0.32",
  to: "0.33",
  transform(config) {
    const plugins = config.plugins as Array<Record<string, unknown>> | undefined;
    if (plugins && Array.isArray(plugins)) {
      for (const plugin of plugins) {
        if (plugin.name === "@openstarry-plugin/context-sliding-window") {
          // Mark as required (Plan33 OQ-33-3)
          plugin.criticality = "required";
        }
      }
    }
    return config;
  },
};

/** All registered migrations in order. */
export const migrations: Migration[] = [
  v032_to_v033,
];

/**
 * Find applicable migrations between two versions.
 */
export function findMigrations(from: string, to: string): Migration[] {
  const applicable: Migration[] = [];
  let current = from;
  for (const m of migrations) {
    if (m.from === current) {
      applicable.push(m);
      current = m.to;
      if (current === to) break;
    }
  }
  return applicable;
}
