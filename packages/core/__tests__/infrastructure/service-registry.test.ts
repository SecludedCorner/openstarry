/**
 * Unit tests for ServiceRegistry.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ServiceRegistry, createServiceRegistry } from "../../src/infrastructure/service-registry.js";
import { ServiceRegistrationError } from "@openstarry/sdk";
import type { IPluginService } from "@openstarry/sdk";

describe("ServiceRegistry", () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    registry = new ServiceRegistry();
  });

  describe("register()", () => {
    it("successfully registers a service", () => {
      const service: IPluginService = { name: "test-service", version: "1.0.0" };

      expect(() => registry.register(service)).not.toThrow();
      expect(registry.get("test-service")).toBe(service);
    });

    it("throws ServiceRegistrationError if service name already exists", () => {
      const service1: IPluginService = { name: "test-service", version: "1.0.0" };
      const service2: IPluginService = { name: "test-service", version: "2.0.0" };

      registry.register(service1);

      expect(() => registry.register(service2)).toThrow(ServiceRegistrationError);
      expect(() => registry.register(service2)).toThrow('Service "test-service" is already registered');
    });

    it("stores service with correct name and version", () => {
      const service: IPluginService = { name: "parser", version: "1.2.3" };

      registry.register(service);
      const retrieved = registry.get("parser");

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("parser");
      expect(retrieved?.version).toBe("1.2.3");
    });

    it("throws error for empty service name", () => {
      const service: IPluginService = { name: "", version: "1.0.0" };

      expect(() => registry.register(service)).toThrow(ServiceRegistrationError);
      expect(() => registry.register(service)).toThrow("non-empty string");
    });

    it("throws error for whitespace-only service name", () => {
      const service: IPluginService = { name: "   ", version: "1.0.0" };

      expect(() => registry.register(service)).toThrow(ServiceRegistrationError);
    });
  });

  describe("get()", () => {
    it("retrieves registered service by name", () => {
      const service: IPluginService = { name: "my-service", version: "1.0.0" };
      registry.register(service);

      const retrieved = registry.get("my-service");

      expect(retrieved).toBe(service);
    });

    it("returns undefined for non-existent service", () => {
      const retrieved = registry.get("nonexistent");

      expect(retrieved).toBeUndefined();
    });

    it("maintains type safety with generics", () => {
      interface ICustomService extends IPluginService {
        customMethod(): string;
      }

      const service: ICustomService = {
        name: "custom",
        version: "1.0.0",
        customMethod: () => "result",
      };

      registry.register(service);
      const retrieved = registry.get<ICustomService>("custom");

      expect(retrieved?.customMethod()).toBe("result");
    });
  });

  describe("has()", () => {
    it("returns true for registered service", () => {
      const service: IPluginService = { name: "my-service", version: "1.0.0" };
      registry.register(service);

      expect(registry.has("my-service")).toBe(true);
    });

    it("returns false for non-existent service", () => {
      expect(registry.has("nonexistent")).toBe(false);
    });
  });

  describe("list()", () => {
    it("returns all registered services", () => {
      const service1: IPluginService = { name: "service-1", version: "1.0.0" };
      const service2: IPluginService = { name: "service-2", version: "2.0.0" };

      registry.register(service1);
      registry.register(service2);

      const services = registry.list();

      expect(services).toHaveLength(2);
      expect(services).toContain(service1);
      expect(services).toContain(service2);
    });

    it("returns empty array when no services registered", () => {
      const services = registry.list();

      expect(services).toEqual([]);
      expect(services).toHaveLength(0);
    });

    it("returns services in registration order", () => {
      const service1: IPluginService = { name: "first", version: "1.0.0" };
      const service2: IPluginService = { name: "second", version: "2.0.0" };
      const service3: IPluginService = { name: "third", version: "3.0.0" };

      registry.register(service1);
      registry.register(service2);
      registry.register(service3);

      const services = registry.list();

      expect(services[0]).toBe(service1);
      expect(services[1]).toBe(service2);
      expect(services[2]).toBe(service3);
    });

    it("returns immutable copy (modifying array does not affect registry)", () => {
      const service: IPluginService = { name: "test", version: "1.0.0" };
      registry.register(service);

      const services1 = registry.list();
      services1.push({ name: "fake", version: "0.0.0" });

      const services2 = registry.list();

      expect(services2).toHaveLength(1);
      expect(services2[0]).toBe(service);
    });
  });

  describe("multiple services", () => {
    it("allows multiple services with different names to coexist", () => {
      const parser: IPluginService = { name: "parser", version: "1.0.0" };
      const renderer: IPluginService = { name: "renderer", version: "2.0.0" };
      const validator: IPluginService = { name: "validator", version: "3.0.0" };

      registry.register(parser);
      registry.register(renderer);
      registry.register(validator);

      expect(registry.get("parser")).toBe(parser);
      expect(registry.get("renderer")).toBe(renderer);
      expect(registry.get("validator")).toBe(validator);
      expect(registry.list()).toHaveLength(3);
    });

    it("rejects service with same name but different version (duplicate check)", () => {
      const v1: IPluginService = { name: "my-service", version: "1.0.0" };
      const v2: IPluginService = { name: "my-service", version: "2.0.0" };

      registry.register(v1);

      expect(() => registry.register(v2)).toThrow(ServiceRegistrationError);
      expect(registry.get("my-service")).toBe(v1);
    });
  });

  describe("agent-scoped isolation", () => {
    it("separate registries do not interfere", () => {
      const registry1 = new ServiceRegistry();
      const registry2 = new ServiceRegistry();

      const service1: IPluginService = { name: "shared-name", version: "1.0.0" };
      const service2: IPluginService = { name: "shared-name", version: "2.0.0" };

      registry1.register(service1);
      registry2.register(service2);

      expect(registry1.get("shared-name")).toBe(service1);
      expect(registry2.get("shared-name")).toBe(service2);
    });
  });

  describe("createServiceRegistry()", () => {
    it("creates a new ServiceRegistry instance", () => {
      const registry = createServiceRegistry();

      expect(registry).toBeDefined();
      expect(typeof registry.register).toBe("function");
      expect(typeof registry.get).toBe("function");
      expect(typeof registry.list).toBe("function");
    });

    it("each invocation creates independent registry", () => {
      const registry1 = createServiceRegistry();
      const registry2 = createServiceRegistry();

      const service: IPluginService = { name: "test", version: "1.0.0" };
      registry1.register(service);

      expect(registry1.list()).toHaveLength(1);
      expect(registry2.list()).toHaveLength(0);
    });
  });
});
