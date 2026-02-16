import { describe, it, expect } from "vitest";
import { getSessionConfig, setSessionConfig, type SessionConfig } from "../session.js";

describe("SessionConfig helpers", () => {
  describe("getSessionConfig", () => {
    it("should extract typed config from metadata", () => {
      const metadata = { config: { allowedPaths: ["/path/a", "/path/b"] } };
      const config = getSessionConfig(metadata);
      expect(config).toBeDefined();
      expect(config?.allowedPaths).toEqual(["/path/a", "/path/b"]);
    });

    it("should return undefined if no config in metadata", () => {
      const metadata = {};
      const config = getSessionConfig(metadata);
      expect(config).toBeUndefined();
    });

    it("should return undefined if metadata is undefined", () => {
      const config = getSessionConfig(undefined);
      expect(config).toBeUndefined();
    });

    it("should handle extensible session config fields", () => {
      const metadata = {
        config: {
          allowedPaths: ["/root"],
          customField: "custom-value",
          maxHistorySize: 100,
        },
      };
      const config = getSessionConfig(metadata);
      expect(config?.allowedPaths).toEqual(["/root"]);
      expect((config as any).customField).toBe("custom-value");
      expect((config as any).maxHistorySize).toBe(100);
    });
  });

  describe("setSessionConfig", () => {
    it("should store typed config in metadata", () => {
      const metadata: Record<string, unknown> = {};
      const config: SessionConfig = { allowedPaths: ["/a", "/b"] };
      setSessionConfig(metadata, config);
      expect(metadata.config).toEqual({ allowedPaths: ["/a", "/b"] });
    });

    it("should overwrite existing config", () => {
      const metadata: Record<string, unknown> = { config: { allowedPaths: ["/old"] } };
      const newConfig: SessionConfig = { allowedPaths: ["/new"] };
      setSessionConfig(metadata, newConfig);
      expect(metadata.config).toEqual({ allowedPaths: ["/new"] });
    });

    it("should preserve other metadata fields", () => {
      const metadata: Record<string, unknown> = {
        otherField: "preserve-me",
        config: { allowedPaths: ["/old"] },
      };
      const newConfig: SessionConfig = { allowedPaths: ["/updated"] };
      setSessionConfig(metadata, newConfig);
      expect(metadata.otherField).toBe("preserve-me");
      expect(metadata.config).toEqual({ allowedPaths: ["/updated"] });
    });

    it("should handle extensible config fields", () => {
      const metadata: Record<string, unknown> = {};
      const config: SessionConfig = {
        allowedPaths: ["/root"],
        customField: "custom",
        sessionTTL: 3600,
      };
      setSessionConfig(metadata, config);
      expect(metadata.config).toEqual({
        allowedPaths: ["/root"],
        customField: "custom",
        sessionTTL: 3600,
      });
    });
  });

  describe("round-trip", () => {
    it("should preserve config through set/get cycle", () => {
      const metadata: Record<string, unknown> = {};
      const originalConfig: SessionConfig = {
        allowedPaths: ["/project/root", "/shared/data"],
      };
      setSessionConfig(metadata, originalConfig);
      const retrievedConfig = getSessionConfig(metadata);
      expect(retrievedConfig).toEqual(originalConfig);
    });
  });
});
