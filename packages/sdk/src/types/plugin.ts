/**
 * Plugin system types.
 */

import type { EventBus, InputEvent } from "./events.js";
import type { IProvider } from "./provider.js";
import type { ITool } from "./tool.js";
import type { IListener } from "./listener.js";
import type { IUI } from "./ui.js";
import type { IGuide } from "./guide.js";
import type { ISessionManager } from "./session.js";
import type { IServiceRegistry } from "./service.js";

/** Plugin manifest — metadata declared by the plugin. */
export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;

  /** Sandbox configuration (optional, default: enabled with 512MB limit) */
  sandbox?: SandboxConfig;

  /**
   * Plugin integrity verification (optional).
   * Legacy format: SHA-512 hash (128-char hex string)
   * PKI format: Ed25519/RSA signature object
   */
  integrity?: string | PkiIntegrity;

  /**
   * Plugin capabilities and permissions (NEW in v0.14.0).
   * Used for fine-grained access control to core services.
   */
  capabilities?: PluginCapabilities;

  /**
   * Services provided by this plugin (optional).
   * NEW IN v0.17.0-beta (Plan19).
   *
   * List of service names this plugin registers.
   * Example: ["skill-parser", "markdown-renderer"]
   *
   * Used for documentation and future dependency validation.
   * Does NOT enforce registration (plugin must still call ctx.services.register).
   */
  services?: string[];

  /**
   * Services required by this plugin (optional).
   * NEW IN v0.17.0-beta (Plan19).
   *
   * List of service names this plugin depends on.
   * Example: ["skill-parser"]
   *
   * Used for dependency validation and documentation.
   * PluginLoader will log warnings if required services are unavailable at plugin init time.
   */
  serviceDependencies?: string[];
}

/** Sandbox configuration for a plugin. */
export interface SandboxConfig {
  /** Enable/disable sandbox isolation. Default: true */
  enabled: boolean;

  /** Memory limit in megabytes. Default: 512 */
  memoryLimitMb?: number;

  /** CPU watchdog timeout in milliseconds. Default: 60000 (60s) */
  cpuTimeoutMs?: number;

  /** Worker restart policy on crash. */
  restartPolicy?: WorkerRestartPolicy;

  /** Additional allowed paths beyond workingDirectory (optional) */
  allowedPaths?: string[];

  /** Allowed network domains for fetch (optional, future extension) */
  allowedDomains?: string[];

  /** Additional modules to block (extends default blocklist) */
  blockedModules?: string[];

  /** Modules to allow (overrides blockedModules for trusted plugins) */
  allowedModules?: string[];

  /** Module interception mode. Default: 'strict' */
  moduleInterception?: 'strict' | 'warn' | 'off';

  /** Audit logging configuration (optional, opt-in) */
  auditLog?: SandboxAuditConfig;
}

/**
 * Configuration for sandbox audit logging.
 * Logs all RPC operations and lifecycle events to structured JSONL files.
 */
export interface SandboxAuditConfig {
  /** Enable audit logging. Default: false (opt-in) */
  enabled: boolean;

  /** Directory for audit log files. Default: '{configDir}/logs/sandbox' */
  logDir?: string;

  /** Buffer size (number of entries before flush). Default: 50 */
  bufferSize?: number;

  /** Flush interval in milliseconds. Default: 5000 (5s) */
  flushIntervalMs?: number;

  /** Maximum log file size in MB before rotation. Default: 50 */
  maxFileSizeMb?: number;

  /** Maximum number of log files to keep. Default: 10 */
  maxFiles?: number;

  /** Sanitize arguments (redact secrets, truncate large values). Default: true */
  sanitizeArgs?: boolean;
}

/**
 * Structured audit log entry for sandbox operations.
 * Written as JSONL (one JSON object per line) to {logDir}/{pluginName}-{timestamp}.jsonl
 */
export interface AuditLogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;

  /** Log level */
  level: 'info' | 'warn' | 'error' | 'audit';

  /** Plugin name */
  pluginName: string;

  /** Operation category */
  category: 'rpc' | 'worker' | 'tool' | 'lifecycle';

  /** Operation name (e.g., 'BUS_EMIT', 'spawn', 'crash', 'invokeTool') */
  operation: string;

  /** RPC method name (for category='rpc') */
  method?: string;

  /** Sanitized arguments (redacted secrets, truncated large values) */
  args?: Record<string, unknown>;

  /** Operation result */
  result?: 'success' | 'error';

  /** Error message (if result='error') */
  error?: string;

  /** Operation duration in milliseconds */
  durationMs?: number;

  /** Additional metadata */
  metadata?: {
    sessionId?: string;
    memoryLimitMb?: number;
    cpuTimeoutMs?: number;
    crashCount?: number;
    messageType?: string;
    [key: string]: unknown;
  };
}

/** Worker restart policy configuration. */
export interface WorkerRestartPolicy {
  /** Maximum number of restarts before giving up. Default: 3 */
  maxRestarts: number;

  /** Initial backoff delay in milliseconds. Default: 500 */
  backoffMs: number;

  /** Maximum backoff delay in milliseconds. Default: 10000 */
  maxBackoffMs: number;

  /** Time window for crash count reset in milliseconds. Default: 60000 */
  resetWindowMs: number;
}

/** Context provided to a plugin during initialization. */
export interface IPluginContext {
  bus: EventBus;
  workingDirectory: string;
  agentId: string;
  config: Record<string, unknown>;
  /** Push an input event into the agent's processing queue. Available to all listener plugins. */
  pushInput: (event: InputEvent) => void;
  /** Session manager for creating and retrieving sessions. */
  sessions: ISessionManager;
  /** Tool registry accessor (optional). Provides lazy access to registered tools. */
  tools?: {
    list(): ITool[];
    get(id: string): ITool | undefined;
  };
  /** Guide registry accessor (optional). Provides lazy access to registered guides. */
  guides?: {
    list(): IGuide[];
  };
  /** Provider registry accessor (optional). Provides lazy access to registered LLM providers. */
  providers?: {
    list(): IProvider[];
    get(id: string): IProvider | undefined;
  };
  /**
   * Service registry accessor (optional). Provides cross-plugin service injection.
   * NEW IN v0.17.0-beta (Plan19).
   *
   * Plugins can register services for other plugins to consume.
   * Example: SkillPlugin registers "skill-parser", WorkflowPlugin consumes it.
   */
  services?: IServiceRegistry;
  /** Command registry accessor (optional). Provides lazy access to registered slash commands. */
  commands?: {
    list(): SlashCommand[];
  };
  /** Metrics accessor (optional). Provides lazy access to observability metrics snapshot. */
  metrics?: {
    getSnapshot(): Record<string, unknown>;
  };
}

/** The hooks a plugin can provide after initialization. */
export interface PluginHooks {
  providers?: IProvider[];
  tools?: ITool[];
  listeners?: IListener[];
  ui?: IUI[];  // 色蘊 — UI renderers
  guides?: IGuide[];
  commands?: SlashCommand[];
  dispose?: () => Promise<void> | void;
}

/** A slash command registered by a plugin. */
export interface SlashCommand {
  name: string;
  description: string;
  execute(args: string, ctx: IPluginContext, sessionId?: string): Promise<string | undefined>;
}

/** PKI signature format for plugin integrity verification */
export interface PkiIntegrity {
  algorithm: 'ed25519-sha256' | 'rsa-sha256';
  signature: string; // Base64-encoded signature bytes
  publicKey: string; // PEM-encoded public key
  author?: string; // Optional author identifier
  timestamp?: number; // Optional signature timestamp (Unix epoch ms)
}

/**
 * Plugin capability declarations (NEW in v0.14.0).
 * Restricts plugin access to core services via whitelist model.
 */
export interface PluginCapabilities {
  /**
   * Whitelist of provider IDs this plugin can access.
   * - If undefined or empty array: plugin can access ALL providers (default, backward compatible)
   * - If non-empty array: plugin can only access providers with matching IDs
   *
   * Example: ["openai", "anthropic"]
   *
   * Security: Prevents untrusted plugins from enumerating or invoking expensive LLM providers.
   */
  allowedProviders?: string[];
}

/** A plugin is a factory function that returns hooks. */
export interface IPlugin {
  manifest: PluginManifest;
  factory: (ctx: IPluginContext) => Promise<PluginHooks>;
}
