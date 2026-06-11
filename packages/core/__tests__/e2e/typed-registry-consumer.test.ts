/**
 * External consumer validation for typed ServiceKey<T> registry.
 * Plan42 W3-2: Proves the typed registry API is usable by external consumers
 * without any `as any` or unsafe casts at the call site.
 *
 * This file simulates an external plugin consuming the service registry
 * through the public @openstarry/sdk surface only.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ServiceKey } from "@openstarry/sdk";
import type { IPluginService, IServiceRegistry } from "@openstarry/sdk";
import { createServiceRegistry } from "../../src/infrastructure/service-registry.js";

// 1. Custom service interface extending IPluginService — as an external consumer would define it.
interface IReportingService extends IPluginService {
  generateReport(topic: string): string;
  reportCount(): number;
}

// 2. ServiceKey<T> bound to the custom interface — no cast required at call site.
const REPORTING_KEY = new ServiceKey<IReportingService>("reporting-service");

describe("Typed Registry — External Consumer", () => {
  let registry: IServiceRegistry;
  let reportingService: IReportingService;

  beforeEach(() => {
    registry = createServiceRegistry();
    reportingService = {
      name: "reporting-service",
      version: "1.0.0",
      generateReport: (topic) => `Report on: ${topic}`,
      reportCount: () => 42,
    };
  });

  // 3. Register via registry.register()
  it("registers a custom service without error", () => {
    expect(() => registry.register(reportingService)).not.toThrow();
  });

  // 4. Retrieve via registry.get(key) — type is IReportingService, no cast at call site.
  it("retrieves service with correct type — no cast needed", () => {
    registry.register(reportingService);

    // retrieved is typed as IReportingService | undefined — no `as` cast here.
    const retrieved = registry.get(REPORTING_KEY);

    expect(retrieved).toBeDefined();
    // Calling domain methods directly on the typed result — proves type safety.
    expect(retrieved?.generateReport("security")).toBe("Report on: security");
    expect(retrieved?.reportCount()).toBe(42);
  });

  // 5. has(key) returns true after registration.
  it("has() returns true for a registered service", () => {
    registry.register(reportingService);
    expect(registry.has(REPORTING_KEY)).toBe(true);
  });

  // 6. unregister(key) removes the service.
  it("unregister() removes the service and returns true", () => {
    registry.register(reportingService);
    expect(registry.unregister(REPORTING_KEY)).toBe(true);
    expect(registry.has(REPORTING_KEY)).toBe(false);
    expect(registry.get(REPORTING_KEY)).toBeUndefined();
  });

  // 7. list() contains the service after registration.
  it("list() contains the registered service", () => {
    registry.register(reportingService);
    const all = registry.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toBe(reportingService);
  });
});
