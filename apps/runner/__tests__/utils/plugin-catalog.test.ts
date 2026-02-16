/**
 * Plugin Catalog unit tests.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  loadCatalog,
  searchCatalog,
  getCatalogEntry,
  getAllCatalogEntries,
  resetCatalogCache,
} from "../../src/utils/plugin-catalog.js";

describe("plugin-catalog", () => {
  beforeEach(() => {
    resetCatalogCache();
  });

  describe("loadCatalog", () => {
    it("returns a valid catalog object", () => {
      const catalog = loadCatalog();
      expect(catalog).toBeDefined();
      expect(catalog.version).toBe("1");
      expect(Array.isArray(catalog.plugins)).toBe(true);
    });

    it("contains 22 official plugins", () => {
      const catalog = loadCatalog();
      expect(catalog.plugins).toHaveLength(22);
    });

    it("each plugin has required fields", () => {
      const catalog = loadCatalog();
      for (const entry of catalog.plugins) {
        expect(entry.name).toBeDefined();
        expect(entry.name).toMatch(/^@openstarry-plugin\//);
        expect(typeof entry.description).toBe("string");
        expect(typeof entry.version).toBe("string");
        expect(Array.isArray(entry.aggregates)).toBe(true);
        expect(Array.isArray(entry.tags)).toBe(true);
      }
    });

    it("caches the result across calls", () => {
      const first = loadCatalog();
      const second = loadCatalog();
      expect(first).toBe(second); // Same reference
    });
  });

  describe("searchCatalog", () => {
    it("finds plugins by name fragment", () => {
      const results = searchCatalog("fs");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.name.includes("fs"))).toBe(true);
    });

    it("finds plugins by description keyword", () => {
      const results = searchCatalog("websocket");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("finds plugins by tag", () => {
      const results = searchCatalog("transport");
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("finds plugins by aggregate", () => {
      const results = searchCatalog("IProvider");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("is case-insensitive", () => {
      const lower = searchCatalog("gemini");
      const upper = searchCatalog("GEMINI");
      expect(lower).toEqual(upper);
    });

    it("returns empty array for no matches", () => {
      const results = searchCatalog("zzz_nonexistent_zzz");
      expect(results).toEqual([]);
    });
  });

  describe("getCatalogEntry", () => {
    it("returns entry for exact name match", () => {
      const entry = getCatalogEntry("@openstarry-plugin/standard-function-fs");
      expect(entry).toBeDefined();
      expect(entry!.name).toBe("@openstarry-plugin/standard-function-fs");
    });

    it("returns undefined for non-existent plugin", () => {
      const entry = getCatalogEntry("@openstarry-plugin/nonexistent");
      expect(entry).toBeUndefined();
    });

    it("does not match partial names", () => {
      const entry = getCatalogEntry("standard-function-fs");
      expect(entry).toBeUndefined();
    });
  });

  describe("getAllCatalogEntries", () => {
    it("returns all 22 entries", () => {
      const entries = getAllCatalogEntries();
      expect(entries).toHaveLength(22);
    });

    it("returns the same data as loadCatalog().plugins", () => {
      const entries = getAllCatalogEntries();
      const catalog = loadCatalog();
      expect(entries).toEqual(catalog.plugins);
    });
  });
});
