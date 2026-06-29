/**
 * Plugin system types.
 */

import type { EventBus, InputEvent } from "./events.js";
import type { IProvider } from "./provider.js";
import type { ITool } from "./tool.js";
import type { IListener, ITypedListener } from "./listener.js";
import type { IUI } from "./ui.js";
import type { IGuide } from "./guide.js";
import type { IVedanaSensor } from "./vedana.js";
import type { IGearArbiter } from "./gear-arbiter.js";
import type { ISessionManager } from "./session.js";
import type { IServiceRegistry } from "./service.js";
import type { Skandha } from "./aggregates.js";
import type { IVolition } from "./volition.js";
import type { ILoopQualityMonitor } from "./loop-quality-monitor.js";
import type { IConfidenceAuditor } from "./confidence-auditor.js";
import type { IContextManager } from "../interfaces/context.js";
import type { IConfirmationGate } from "./confirmation-gate.js";
import type { ICommChannel } from "./comm-channel.js";

/** Plugin manifest — metadata declared by the plugin. */
export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;

  /**
   * Sandbox configuration (optional, OPT-IN). When this object is ABSENT the
   * plugin runs IN-PROCESS with NO worker-thread isolation. Worker isolation is
   * engaged only when `sandbox.enabled === true` (see PluginLoader). Off by default.
   */
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

  /**
   * Five Aggregates classification (optional).
   * NEW IN v0.25.0-beta (Plan25 — M-7 multi-value skandha).
   *
   * Declares which aggregate(s) this plugin belongs to.
   * Single value or array for cross-aggregate plugins.
   *
   * Example: 'samjna' or ['samskara', 'vijnana']
   */
  skandha?: Skandha | readonly Skandha[];

  /**
   * Plugin dependencies (optional).
   * NEW IN v0.33.0-alpha (Plan33 OQ-33-1).
   *
   * List of plugin names this plugin requires to be loaded.
   * PluginLoader validates all dependencies are present before calling factory().
   * Missing dependencies → logger.error() + skip loading this plugin.
   *
   * Note: This is name-based (matches manifest.name), not version-based.
   * Distinct from serviceDependencies which declares service-level dependencies.
   */
  dependencies?: string[];

  /**
   * Criticality level for this plugin (optional, default: 'optional-no-effect').
   * NEW IN v0.33.0-alpha (Plan33 OQ-33-3).
   *
   * - 'required': Agent refuses to start() if this plugin is absent. throw Error().
   * - 'optional-degraded': Agent starts but feature operates at neutral (delta=0, empty).
   *   Wording: "安全增強層未啟用，其餘功能正常"
   * - 'optional-no-effect': Agent starts normally, feature simply unavailable.
   */
  criticality?: PluginCriticality;
}

/**
 * Plugin criticality level.
 * NEW IN v0.33.0-alpha (Plan33 OQ-33-3).
 */
export type PluginCriticality = 'required' | 'optional-degraded' | 'optional-no-effect';

/** Sandbox configuration for a plugin. */
export interface SandboxConfig {
  /**
   * Enable worker-thread isolation for this plugin. OPT-IN: a plugin runs
   * in-process unless this is explicitly `true` (the loader gates on
   * `sandbox?.enabled === true`). There is no implicit default-on.
   */
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
  listeners?: (ITypedListener | IListener)[];
  ui?: IUI[];  // 色蘊 — UI renderers
  guides?: IGuide[];
  commands?: SlashCommand[];
  vedanaSensors?: IVedanaSensor[];  // 受蘊 — vedana sensors (Plan26)
  gearArbiters?: IGearArbiter[];   // 識蘊 — gear arbiters (Plan27)
  volition?: IVolition;            // 識蘊 — IVolition deliberation (Plan28)
  monitors?: ILoopQualityMonitor[];  // 識蘊 — loop quality monitors (Plan29)
  auditor?: IConfidenceAuditor;      // 識蘊 — confidence auditor (Plan29, last-wins)
  contextManager?: IContextManager;   // 想蘊 — context assembly strategy (Plan32 Wave 6, last-wins)
  confirmationGate?: IConfirmationGate;  // 行蘊 — T3 confirmation gate (Plan36b, last-wins)
  commChannels?: ICommChannel[];  // 色蘊 — multi-agent communication channels (Plan37)
  /**
   * Called by the framework to request a state snapshot for cross-session
   * persistence. Returns `null` when the plugin has no snapshottable state
   * or an internal error prevents snapshotting. MUST NOT throw.
   *
   * Plan46 W2 / K-3 SDK framework hook. @since v0.46.0-alpha.
   */
  onCheckpoint?: () => PluginSnapshot | null;
  /**
   * Called by the framework to restore a previously captured snapshot.
   * May throw on invalid data — the framework catches and falls back to
   * fresh state, consistent with SafetyGate/StateTracker snapshot semantics.
   *
   * Plan46 W2 / K-3 SDK framework hook. @since v0.46.0-alpha.
   */
  onRestore?: (snapshot: PluginSnapshot) => void;
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

  /**
   * Whitelist of tool IDs this plugin can invoke via ctx.tools (SDK type only — Plan45).
   * - undefined or empty: plugin can access ALL tools (backward compatible default)
   * - non-empty array: future runtime enforcement (Plan46) will filter ctx.tools.list() and ctx.tools.get() by this whitelist
   *
   * Runtime enforcement is DEFERRED TO PLAN46. This field exists in the SDK now so plugin manifests
   * written against v0.45.0 will remain forward-compatible when Plan46 adds the runner-level filter proxy.
   *
   * Added in v0.45.0-alpha (Plan45, W3 SDK type carry-forward).
   */
  allowedTools?: string[];
}

/**
 * PluginSnapshot — opaque state container for plugin checkpoint/restore.
 *
 * Plan46 W2 / K-3 SDK framework hook (Rule #45 re-freeze authorized R3 D10-Q32).
 *
 * Plugins serialize their internal state into `state` (free-form JSON-safe
 * record). `pluginName` and `schemaVersion` identify the producer so the
 * restore side can validate compatibility before applying the snapshot.
 *
 * Framework contract: the CheckpointManager treats this type as opaque.
 *
 * @since v0.46.0-alpha (Plan46, W2). FROZEN after delivery per Rule #45.
 */
export interface PluginSnapshot {
  readonly pluginName: string;
  readonly schemaVersion: number;
  readonly state: Readonly<Record<string, unknown>>;
  readonly timestamp: number;
}

/** A plugin is a factory function that returns hooks. */
export interface IPlugin {
  manifest: PluginManifest;
  factory: (ctx: IPluginContext) => Promise<PluginHooks>;
}
