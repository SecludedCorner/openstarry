/**
 * Integration tests for cross-plugin service injection.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createServiceRegistry } from "../../src/infrastructure/service-registry.js";
import type { IPluginService, IServiceRegistry } from "@openstarry/sdk";
import { ServiceRegistrationError } from "@openstarry/sdk";

interface ICustomService extends IPluginService {
  customMethod(): string;
}

describe("Service Injection - E2E", () => {
  let registry: IServiceRegistry;

  beforeEach(() => {
    registry = createServiceRegistry();
  });

  it("Plugin A registers service, Plugin B retrieves and uses it", () => {
    // Plugin A (provider)
    const parserService: ICustomService = {
      name: "skill-parser",
      version: "1.0.0",
      customMethod: () => "parsed result",
    };
    registry.register(parserService);

    // Plugin B (consumer)
    const retrieved = registry.get<ICustomService>("skill-parser");
    expect(retrieved).toBeDefined();
    expect(retrieved?.customMethod()).toBe("parsed result");
  });

  it("Plugin B loads before Plugin A results in service unavailable (load order matters)", () => {
    // Plugin B tries to get service before A registers it
    const service = registry.get("nonexistent-service");
    expect(service).toBeUndefined();

    // Plugin A registers later
    const lateService: IPluginService = { name: "late-service", version: "1.0.0" };
    registry.register(lateService);

    // Now B can get it
    const retrieved = registry.get("late-service");
    expect(retrieved).toBe(lateService);
  });

  it("Plugin A registers multiple services, Plugin B retrieves all", () => {
    const service1: IPluginService = { name: "service-1", version: "1.0.0" };
    const service2: IPluginService = { name: "service-2", version: "2.0.0" };
    const service3: IPluginService = { name: "service-3", version: "3.0.0" };

    registry.register(service1);
    registry.register(service2);
    registry.register(service3);

    const all = registry.list();
    expect(all).toHaveLength(3);
    expect(all).toContain(service1);
    expect(all).toContain(service2);
    expect(all).toContain(service3);
  });

  it("Service implements custom methods beyond IPluginService interface", () => {
    interface IAdvancedService extends IPluginService {
      calculate(a: number, b: number): number;
      format(input: string): string;
    }

    const advancedService: IAdvancedService = {
      name: "calculator",
      version: "1.0.0",
      calculate: (a, b) => a + b,
      format: (input) => `Result: ${input}`,
    };

    registry.register(advancedService);
    const retrieved = registry.get<IAdvancedService>("calculator");

    expect(retrieved?.calculate(2, 3)).toBe(5);
    expect(retrieved?.format("test")).toBe("Result: test");
  });

  it("Plugin attempts to register duplicate service name results in error propagated", () => {
    const service1: IPluginService = { name: "duplicate", version: "1.0.0" };
    const service2: IPluginService = { name: "duplicate", version: "2.0.0" };

    registry.register(service1);

    expect(() => registry.register(service2)).toThrow(ServiceRegistrationError);
    expect(() => registry.register(service2)).toThrow('Service "duplicate" is already registered');

    // First registration still exists
    expect(registry.get("duplicate")).toBe(service1);
  });

  it("Plugin with serviceDependencies but service unavailable results in warning (tested elsewhere)", () => {
    // This test is primarily handled by PluginLoader tests
    // Here we just verify registry behavior
    const service = registry.get("missing-dependency");
    expect(service).toBeUndefined();
  });

  it("Mock service registry injected for testing purposes", () => {
    // Create a mock registry for testing
    const mockRegistry = createServiceRegistry();
    const mockService: IPluginService = { name: "mock-service", version: "0.0.1" };
    mockRegistry.register(mockService);

    // Verify mock works independently
    expect(mockRegistry.get("mock-service")).toBe(mockService);
    expect(registry.get("mock-service")).toBeUndefined();
  });

  it("Service registry cleared between test cases (no cross-test contamination)", () => {
    // This test should start with clean state
    expect(registry.list()).toHaveLength(0);

    // Add a service
    const service: IPluginService = { name: "temp", version: "1.0.0" };
    registry.register(service);

    expect(registry.list()).toHaveLength(1);

    // Next test will have clean state (verified by beforeEach)
  });

  it("Service with complex nested data structures", () => {
    interface IDataService extends IPluginService {
      data: {
        nested: {
          value: string;
          items: string[];
        };
      };
      getData(): typeof this.data;
    }

    const dataService: IDataService = {
      name: "data-service",
      version: "1.0.0",
      data: {
        nested: {
          value: "test",
          items: ["a", "b", "c"],
        },
      },
      getData() { return this.data; },
    };

    registry.register(dataService);
    const retrieved = registry.get<IDataService>("data-service");

    expect(retrieved?.data.nested.value).toBe("test");
    expect(retrieved?.data.nested.items).toEqual(["a", "b", "c"]);
    expect(retrieved?.getData()).toBe(dataService.data);
  });
});
