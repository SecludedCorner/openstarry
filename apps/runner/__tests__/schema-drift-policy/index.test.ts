/**
 * Plan49 C49-M3a — schema-drift-policy central module 3-mode tests + C49-M3g process-global
 * uniformity integration test.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentConfigSchema } from "@openstarry/shared";
import {
  applySchemaDriftPolicy,
  resolveSchemaDriftMode,
  setSchemaDriftAuditSink,
  SchemaDriftError,
  __resetSchemaDriftModeForTests,
  type SchemaDriftAuditEvent,
} from "../../src/schema-drift-policy/index.js";

// Use an already-exported Zod schema from @openstarry/shared so the test file
// does not need its own `zod` runtime import. A minimal AgentConfig that
// validates is enough to exercise the 3-mode policy logic.
const validAgentConfig = {
  identity: { id: "a", name: "b", description: "c", version: "1.0.0" },
  cognition: { provider: "p", model: "m" },
  capabilities: { tools: ["fs.read"], allowedPaths: ["/tmp"] },
  policy: { maxConcurrentTools: 1, toolTimeout: 1000 },
  memory: { slidingWindowSize: 5 },
  plugins: [{ name: "@openstarry-plugin/standard-function-fs" }],
  guide: "g",
};

// A structurally invalid config for the failure path (missing required keys).
const invalidAgentConfig = { identity: { id: "x" } };

describe("schema-drift-policy (Plan49 C49-M3a)", () => {
  let savedMode: string | undefined;

  beforeEach(() => {
    savedMode = process.env.SCHEMA_DRIFT_MODE;
    __resetSchemaDriftModeForTests();
    setSchemaDriftAuditSink(undefined);
  });

  afterEach(() => {
    if (savedMode === undefined) delete process.env.SCHEMA_DRIFT_MODE;
    else process.env.SCHEMA_DRIFT_MODE = savedMode;
    __resetSchemaDriftModeForTests();
    setSchemaDriftAuditSink(undefined);
  });

  describe("resolveSchemaDriftMode", () => {
    it("defaults to tolerant when env var is unset", () => {
      delete process.env.SCHEMA_DRIFT_MODE;
      __resetSchemaDriftModeForTests();
      expect(resolveSchemaDriftMode()).toBe("tolerant");
    });

    it("reads tolerant / strict / audited from env var", () => {
      for (const mode of ["tolerant", "strict", "audited"] as const) {
        process.env.SCHEMA_DRIFT_MODE = mode;
        __resetSchemaDriftModeForTests();
        expect(resolveSchemaDriftMode()).toBe(mode);
      }
    });

    it("falls back to tolerant for unknown env var values", () => {
      process.env.SCHEMA_DRIFT_MODE = "bogus";
      __resetSchemaDriftModeForTests();
      expect(resolveSchemaDriftMode()).toBe("tolerant");
    });

    it("caches the resolved mode (process-global — C49-M3g)", () => {
      process.env.SCHEMA_DRIFT_MODE = "strict";
      __resetSchemaDriftModeForTests();
      expect(resolveSchemaDriftMode()).toBe("strict");
      // Changing env var after first resolve must not affect cached value.
      process.env.SCHEMA_DRIFT_MODE = "tolerant";
      expect(resolveSchemaDriftMode()).toBe("strict");
    });
  });

  describe("applySchemaDriftPolicy — tolerant mode (default, backward-compat)", () => {
    it("returns ok:true + data on valid input", () => {
      const r = applySchemaDriftPolicy(
        AgentConfigSchema,
        validAgentConfig,
        "test",
        "tolerant",
      );
      expect(r.ok).toBe(true);
    });

    it("returns ok:false + error on invalid input without throwing", () => {
      const r = applySchemaDriftPolicy(
        AgentConfigSchema,
        invalidAgentConfig,
        "test",
        "tolerant",
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    });
  });

  describe("applySchemaDriftPolicy — strict mode", () => {
    it("returns ok:true + data on valid input", () => {
      const r = applySchemaDriftPolicy(
        AgentConfigSchema,
        validAgentConfig,
        "test",
        "strict",
      );
      expect(r.ok).toBe(true);
    });

    it("throws SchemaDriftError on invalid input", () => {
      expect(() =>
        applySchemaDriftPolicy(AgentConfigSchema, invalidAgentConfig, "ctx-under-test", "strict"),
      ).toThrowError(SchemaDriftError);
    });
  });

  describe("applySchemaDriftPolicy — audited mode", () => {
    it("emits a schema_drift_audit event on failure and returns ok:false", () => {
      const events: SchemaDriftAuditEvent[] = [];
      setSchemaDriftAuditSink((e) => events.push(e));

      const r = applySchemaDriftPolicy(
        AgentConfigSchema,
        invalidAgentConfig,
        "audited-ctx",
        "audited",
      );

      expect(r.ok).toBe(false);
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe("schema_drift_audit");
      expect(events[0].context).toBe("audited-ctx");
      expect(events[0].mode).toBe("audited");
      expect(events[0].accepted).toBe(false);
    });

    it("does not emit on success", () => {
      const events: SchemaDriftAuditEvent[] = [];
      setSchemaDriftAuditSink((e) => events.push(e));
      const r = applySchemaDriftPolicy(
        AgentConfigSchema,
        validAgentConfig,
        "audited-ctx",
        "audited",
      );
      expect(r.ok).toBe(true);
      expect(events).toHaveLength(0);
    });
  });

  describe("C49-M3g process-global uniformity", () => {
    it("all call-sites without overrideMode read the single resolved mode", () => {
      process.env.SCHEMA_DRIFT_MODE = "strict";
      __resetSchemaDriftModeForTests();

      // Simulate two independent call-sites each invoking policy without overrideMode.
      // Both must observe the same (strict) mode → both throw on failure.
      expect(() => applySchemaDriftPolicy(AgentConfigSchema, invalidAgentConfig, "site-A")).toThrow(
        SchemaDriftError,
      );
      expect(() => applySchemaDriftPolicy(AgentConfigSchema, invalidAgentConfig, "site-B")).toThrow(
        SchemaDriftError,
      );

      // And both succeed on valid input.
      const ra = applySchemaDriftPolicy(AgentConfigSchema, validAgentConfig, "site-A");
      const rb = applySchemaDriftPolicy(AgentConfigSchema, validAgentConfig, "site-B");
      expect(ra.ok).toBe(true);
      expect(rb.ok).toBe(true);
    });
  });
});
