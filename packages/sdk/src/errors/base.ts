/**
 * Error hierarchy for the agent system.
 */

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    options?: { cause?: Error },
  ) {
    super(message, options);
    this.name = "AgentError";
  }
}

export class ToolExecutionError extends AgentError {
  constructor(
    public readonly toolName: string,
    message: string,
    public readonly cause?: Error,
  ) {
    super(`Tool "${toolName}" failed: ${message}`, "TOOL_EXECUTION_ERROR", { cause });
    this.name = "ToolExecutionError";
  }
}

export class ProviderError extends AgentError {
  constructor(
    public readonly providerId: string,
    message: string,
    public readonly statusCode?: number,
  ) {
    super(`Provider "${providerId}" error: ${message}`, "PROVIDER_ERROR");
    this.name = "ProviderError";
  }
}

export class PluginLoadError extends AgentError {
  constructor(
    public readonly pluginName: string,
    message: string,
    public readonly cause?: Error,
  ) {
    super(`Failed to load plugin "${pluginName}": ${message}`, "PLUGIN_LOAD_ERROR", { cause });
    this.name = "PluginLoadError";
  }
}

export class SecurityError extends AgentError {
  constructor(message: string) {
    super(message, "SECURITY_ERROR");
    this.name = "SecurityError";
  }
}

export class TransportError extends AgentError {
  constructor(
    public readonly transport: string,
    message: string,
    options?: { cause?: Error; code?: string },
  ) {
    super(`Transport "${transport}" error: ${message}`, options?.code ?? "TRANSPORT_ERROR", options);
    this.name = "TransportError";
  }
}

export class SessionError extends AgentError {
  constructor(
    public readonly sessionId: string,
    message: string,
    options?: { cause?: Error; code?: string },
  ) {
    super(`Session "${sessionId}" error: ${message}`, options?.code ?? "SESSION_ERROR", options);
    this.name = "SessionError";
  }
}

export class ConfigError extends AgentError {
  constructor(
    message: string,
    options?: { cause?: Error; code?: string },
  ) {
    super(message, options?.code ?? "CONFIG_ERROR", options);
    this.name = "ConfigError";
  }
}

/**
 * Error thrown by sandbox operations (plugin isolation).
 */
export class SandboxError extends AgentError {
  constructor(
    public readonly pluginName: string,
    message: string,
    options?: { cause?: Error; code?: string },
  ) {
    super(`Sandbox error for plugin "${pluginName}": ${message}`, options?.code ?? "SANDBOX_ERROR", options);
    this.name = "SandboxError";
  }
}

/**
 * Error thrown by MCP client operations.
 */
export class McpError extends AgentError {
  constructor(
    public readonly serverName: string,
    message: string,
    options?: { cause?: Error; code?: string },
  ) {
    super(`MCP server "${serverName}" error: ${message}`, options?.code ?? "MCP_PROTOCOL_ERROR", options);
    this.name = "McpError";
  }
}

/**
 * Error thrown when service registration fails.
 * Common causes:
 * - Service name already registered
 * - Invalid service name format
 */
export class ServiceRegistrationError extends Error {
  public readonly serviceName: string;

  constructor(serviceName: string, message: string, cause?: Error) {
    super(message, { cause });
    this.name = "ServiceRegistrationError";
    this.serviceName = serviceName;
  }
}

/**
 * Error thrown when a required service dependency is missing.
 * Used for validation warnings in PluginLoader.
 */
export class ServiceDependencyError extends Error {
  public readonly pluginName: string;
  public readonly missingServices: string[];

  constructor(pluginName: string, missingServices: string[], cause?: Error) {
    super(
      `Plugin "${pluginName}" requires missing services: ${missingServices.join(", ")}`,
      { cause }
    );
    this.name = "ServiceDependencyError";
    this.pluginName = pluginName;
    this.missingServices = missingServices;
  }
}
