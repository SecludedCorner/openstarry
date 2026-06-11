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
 * ServiceKey<T> — typed key for compile-time safe service registry access.
 *
 * The phantom type parameter enables the registry to return correctly typed
 * services without unsafe `as T` casts. Pattern established in io-ts, fp-ts,
 * Angular InjectionToken.
 *
 * FROZEN: Architecture_Spec Plan41, Cycle 20260407_cycle03-5.
 * @since v0.41.0-alpha (D4-Q3, AC-TSR-1)
 */
export class ServiceKey<T extends IPluginService> {
  readonly _phantom?: T;
  constructor(readonly name: string) {}
}

/**
 * Well-known service keys for typed registry access.
 * New services MUST register a key here for type-safe lookup.
 *
 * FROZEN: Architecture_Spec Plan41, Cycle 20260407_cycle03-5.
 * @since v0.41.0-alpha
 */
import type { ICognitionConfigService } from "./cognition.js";
import type { IDistributedAlaya } from "./distributed-alaya.js";

export const SERVICE_KEYS = {
  COGNITION_CONFIG: new ServiceKey<ICognitionConfigService>("cognition-config"),
  DISTRIBUTED_ALAYA: new ServiceKey<IDistributedAlaya & IPluginService>("distributed-alaya"),
} as const;

/**
 * Service registry interface for plugin service discovery and access.
 * Injected into IPluginContext as optional field.
 *
 * FROZEN: Architecture_Spec Plan41, Cycle 20260407_cycle03-5.
 * Updated: typed overloads via ServiceKey<T> (D4-Q3, AC-TSR-2/3).
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
   * Retrieve a registered service by typed key.
   *
   * @param key - ServiceKey<T> for compile-time type safety
   * @returns Correctly typed service instance if found, undefined otherwise
   */
  get<T extends IPluginService>(key: ServiceKey<T>): T | undefined;

  /**
   * Check if a service is registered by typed key.
   *
   * @param key - ServiceKey<T>
   * @returns True if service exists, false otherwise
   */
  has(key: ServiceKey<IPluginService>): boolean;

  /**
   * List all registered services.
   *
   * @returns Array of all registered service instances
   */
  list(): IPluginService[];

  /**
   * Unregister a service by typed key.
   * @param key - ServiceKey<T>
   * @returns True if service was found and removed, false otherwise
   */
  unregister(key: ServiceKey<IPluginService>): boolean;
}
