/**
 * Service registry implementation for cross-plugin service injection.
 */

import type { IPluginService, IServiceRegistry } from "@openstarry/sdk";
import { ServiceRegistrationError } from "@openstarry/sdk";

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
   * Retrieve a registered service by name.
   *
   * @param name - Service name (e.g., "skill-parser")
   * @returns Service instance if found, undefined otherwise
   */
  get<T extends IPluginService>(name: string): T | undefined {
    return this.services.get(name) as T | undefined;
  }

  /**
   * Check if a service is registered.
   *
   * @param name - Service name
   * @returns True if service exists, false otherwise
   */
  has(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * List all registered services.
   *
   * @returns Array of all registered service instances (shallow copy)
   */
  list(): IPluginService[] {
    return Array.from(this.services.values());
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
