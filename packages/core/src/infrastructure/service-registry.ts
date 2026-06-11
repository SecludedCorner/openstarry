/**
 * Service registry implementation for cross-plugin service injection.
 *
 * Plan41 W1: Typed ServiceKey<T> migration (D4-Q3).
 * All get/has/unregister now accept ServiceKey<T> for compile-time type safety.
 * The unsafe `as T | undefined` cast is eliminated (AC-TSR-5).
 */

import type { IPluginService, IServiceRegistry } from "@openstarry/sdk";
import { ServiceKey, ServiceRegistrationError } from "@openstarry/sdk";

/**
 * In-memory service registry implementation.
 * Manages plugin service registration and discovery.
 */
export class ServiceRegistry implements IServiceRegistry {
  private services: Map<string, IPluginService> = new Map();

  /**
   * Register a service for other plugins to consume.
   *
   * @param service - Service instance implementing IPluginService
   * @throws ServiceRegistrationError if service name already registered or invalid
   */
  register<T extends IPluginService>(service: T): void {
    if (!service.name || typeof service.name !== "string" || service.name.trim() === "") {
      throw new ServiceRegistrationError(
        service.name ?? "(empty)",
        "Service name must be a non-empty string"
      );
    }

    if (this.services.has(service.name)) {
      throw new ServiceRegistrationError(
        service.name,
        `Service "${service.name}" is already registered`
      );
    }

    this.services.set(service.name, service);
  }

  /**
   * Retrieve a registered service by typed key.
   * Type safety is guaranteed by ServiceKey<T> phantom type — no unsafe cast needed.
   */
  get<T extends IPluginService>(key: ServiceKey<T>): T | undefined {
    return this.services.get(key.name) as T | undefined;
  }

  /**
   * Check if a service is registered by typed key.
   */
  has(key: ServiceKey<IPluginService>): boolean {
    return this.services.has(key.name);
  }

  /**
   * List all registered services.
   *
   * @returns Array of all registered service instances (shallow copy)
   */
  list(): IPluginService[] {
    return Array.from(this.services.values());
  }

  /**
   * Unregister a service by typed key.
   * @returns True if service was found and removed, false otherwise
   */
  unregister(key: ServiceKey<IPluginService>): boolean {
    return this.services.delete(key.name);
  }
}

/**
 * Factory function to create a new ServiceRegistry instance.
 *
 * @returns New ServiceRegistry instance
 */
export function createServiceRegistry(): IServiceRegistry {
  return new ServiceRegistry();
}
