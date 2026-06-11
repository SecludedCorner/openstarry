/**
 * Tests for config migration registry (Plan33 OQ-33-4).
 */
import { describe, it, expect } from "vitest";
import { findMigrations, migrations } from "../../src/migrations/index.js";

describe("Config migrations (Plan33 OQ-33-4)", () => {
  it("has at least one migration registered", () => {
    expect(migrations.length).toBeGreaterThanOrEqual(1);
  });

  it("findMigrations returns v0.32→v0.33 migration", () => {
    const found = findMigrations("0.32", "0.33");
    expect(found).toHaveLength(1);
    expect(found[0].from).toBe("0.32");
    expect(found[0].to).toBe("0.33");
  });

  it("findMigrations returns empty for unknown version range", () => {
    const found = findMigrations("0.99", "1.0");
    expect(found).toHaveLength(0);
  });

  it("v0.32→v0.33 migration adds criticality to context-sliding-window", () => {
    const config = {
      plugins: [
        { name: "@openstarry-plugin/context-sliding-window" },
        { name: "@openstarry-plugin/some-other" },
      ],
    };
    const [migration] = findMigrations("0.32", "0.33");
    const result = migration.transform(config as any);
    const plugins = result.plugins as Array<Record<string, unknown>>;
    expect(plugins[0].criticality).toBe("required");
    expect(plugins[1].criticality).toBeUndefined();
  });

  it("v0.32→v0.33 migration handles config without plugins", () => {
    const config = { name: "my-agent" };
    const [migration] = findMigrations("0.32", "0.33");
    const result = migration.transform(config as any);
    expect(result.name).toBe("my-agent");
  });
});
