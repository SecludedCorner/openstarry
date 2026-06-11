/**
 * Unit tests for ServiceRegistry.
 * Plan41 W1: Updated to use ServiceKey<T> typed API (AC-TSR-2/3).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ServiceRegistry, createServiceRegistry } from "../../src/infrastructure/service-registry.js";
import { ServiceRegistrationError, ServiceKey } from "@openstarry/sdk";
import type { IPluginService } from "@openstarry/sdk";

describe("ServiceRegistry", () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    registry = new ServiceRegistry();
  });

  describe("register()", () => {
    it("successfully registers a service", () => {
      const service: IPluginService = { name: "test-service", version: "1.0.0" };
      const key = new ServiceKey<IPluginService>("test-service");

      expect(() => registry.register(service)).not.toThrow();
      expect(registry.get(key)).toBe(service);
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
      const key = new ServiceKey<IPluginService>("parser");

      registry.register(service);
      const retrieved = registry.get(key);

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
    it("retrieves registered service by ServiceKey", () => {
      const service: IPluginService = { name: "my-service", version: "1.0.0" };
      const key = new ServiceKey<IPluginService>("my-service");
      registry.register(service);

      const retrieved = registry.get(key);

      expect(retrieved).toBe(service);
    });

    it("returns undefined for non-existent service", () => {
      const key = new ServiceKey<IPluginService>("nonexistent");
      const retrieved = registry.get(key);

      expect(retrieved).toBeUndefined();
    });

    it("maintains type safety with ServiceKey generics", () => {
      interface ICustomService extends IPluginService {
        customMethod(): string;
      }

      const service: ICustomService = {
        name: "custom",
        version: "1.0.0",
        customMethod: () => "result",
      };
      const key = new ServiceKey<ICustomService>("custom");

      registry.register(service);
      const retrieved = registry.get(key);

      expect(retrieved?.customMethod()).toBe("result");
    });
  });

  describe("has()", () => {
    it("returns true for registered service", () => {
      const service: IPluginService = { name: "my-service", version: "1.0.0" };
      const key = new ServiceKey<IPluginService>("my-service");
      registry.register(service);

      expect(registry.has(key)).toBe(true);
    });

    it("returns false for non-existent service", () => {
      const key = new ServiceKey<IPluginService>("nonexistent");
      expect(registry.has(key)).toBe(false);
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
      const parserKey = new ServiceKey<IPluginService>("parser");
      const rendererKey = new ServiceKey<IPluginService>("renderer");
      const validatorKey = new ServiceKey<IPluginService>("validator");

      registry.register(parser);
      registry.register(renderer);
      registry.register(validator);

      expect(registry.get(parserKey)).toBe(parser);
      expect(registry.get(rendererKey)).toBe(renderer);
      expect(registry.get(validatorKey)).toBe(validator);
      expect(registry.list()).toHaveLength(3);
    });

    it("rejects service with same name but different version (duplicate check)", () => {
      const v1: IPluginService = { name: "my-service", version: "1.0.0" };
      const v2: IPluginService = { name: "my-service", version: "2.0.0" };
      const key = new ServiceKey<IPluginService>("my-service");

      registry.register(v1);

      expect(() => registry.register(v2)).toThrow(ServiceRegistrationError);
      expect(registry.get(key)).toBe(v1);
    });
  });

  describe("unregister()", () => {
    it("removes a registered service and returns true", () => {
      const service: IPluginService = { name: "removable", version: "1.0.0" };
      const key = new ServiceKey<IPluginService>("removable");
      registry.register(service);

      const result = registry.unregister(key);

      expect(result).toBe(true);
      expect(registry.has(key)).toBe(false);
      expect(registry.get(key)).toBeUndefined();
      expect(registry.list()).toHaveLength(0);
    });

    it("returns false for non-existent service", () => {
      const key = new ServiceKey<IPluginService>("nonexistent");
      const result = registry.unregister(key);

      expect(result).toBe(false);
    });

    it("allows re-registration after unregister", () => {
      const service1: IPluginService = { name: "reusable", version: "1.0.0" };
      const service2: IPluginService = { name: "reusable", version: "2.0.0" };
      const key = new ServiceKey<IPluginService>("reusable");

      registry.register(service1);
      registry.unregister(key);
      registry.register(service2);

      expect(registry.get(key)).toBe(service2);
    });
  });

  describe("agent-scoped isolation", () => {
    it("separate registries do not interfere", () => {
      const registry1 = new ServiceRegistry();
      const registry2 = new ServiceRegistry();
      const key = new ServiceKey<IPluginService>("shared-name");

      const service1: IPluginService = { name: "shared-name", version: "1.0.0" };
      const service2: IPluginService = { name: "shared-name", version: "2.0.0" };

      registry1.register(service1);
      registry2.register(service2);

      expect(registry1.get(key)).toBe(service1);
      expect(registry2.get(key)).toBe(service2);
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
      const key = new ServiceKey<IPluginService>("test");

      const service: IPluginService = { name: "test", version: "1.0.0" };
      registry1.register(service);

      expect(registry1.list()).toHaveLength(1);
      expect(registry2.list()).toHaveLength(0);
    });
  });
});
