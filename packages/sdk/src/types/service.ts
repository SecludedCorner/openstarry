/**
 * Base interface for all plugin services.
 * Services are named capabilities that plugins can register for other plugins to consume.
 *
 * Example: A SkillPlugin might register a "skill-parser" service that provides
 * markdown parsing capabilities for WorkflowPlugin to use.
 */
export interface IPluginService {
  /**
   * Unique service name.
   * Convention: kebab-case, e.g., "skill-parser", "mcp-gateway"
   */
  name: string;

  /**
   * Service version (semver format recommended but not enforced in MVP).
   * Used for compatibility checks in future enhancements.
   */
  version: string;
}

/**
 * Service registry interface for plugin service discovery and access.
 * Injected into IPluginContext as optional field.
 */
export interface IServiceRegistry {
  /**
   * Register a service for other plugins to consume.
   *
   * @param service - Service instance implementing IPluginService
   * @throws ServiceRegistrationError if service name already registered
   */
  register<T extends IPluginService>(service: T): void;

  /**
   * Retrieve a registered service by name.
   *
   * @param name - Service name (e.g., "skill-parser")
   * @returns Service instance if found, undefined otherwise
   */
  get<T extends IPluginService>(name: string): T | undefined;

  /**
   * Check if a service is registered.
   *
   * @param name - Service name
   * @returns True if service exists, false otherwise
   */
  has(name: string): boolean;

  /**
   * List all registered services.
   *
   * @returns Array of all registered service instances
   */
  list(): IPluginService[];
}
