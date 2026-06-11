/**
 * Sandbox manager configuration defaults.
 *
 * Plan32 Wave 4 (P2): extracted from core/sandbox hardcoded constants.
 * All values are required at runtime; user overrides via IAgentConfig.sandbox.
 *
 * @skandha samskara (行蘊)
 * @module sandbox-defaults
 */

import type { WorkerRestartPolicy } from "./plugin.js";

/**
 * SandboxManagerConfig — worker sandbox resource limits and policies.
 */
export interface SandboxManagerConfig {
  /** Worker memory limit in MB (default: 512) */
  readonly memoryLimitMb: number;
  /** RPC call timeout in ms (default: 30000) */
  readonly rpcTimeoutMs: number;
  /** Worker CPU timeout in ms (default: 60000) */
  readonly cpuTimeoutMs: number;
  /** Heartbeat check interval in ms (default: 45000) */
  readonly heartbeatCheckIntervalMs: number;
  /** Worker restart policy */
  readonly restartPolicy: WorkerRestartPolicy;
  /** Worker shutdown grace period in ms (default: 5000) */
  readonly shutdownTimeoutMs: number;
}

/**
 * AuditLoggerConfig — sandbox audit logger configuration.
 */
export interface AuditLoggerConfig {
  /** Max string length in sanitization (default: 200) */
  readonly maxStringLength: number;
  /** Max sanitization recursion depth (default: 3) */
  readonly maxSanitizeDepth: number;
  /** Buffer size before flush (default: 50) */
  readonly bufferSize: number;
  /** Flush interval in ms (default: 5000) */
  readonly flushIntervalMs: number;
  /** Maximum file size in MB (default: 50) */
  readonly maxFileSizeMb: number;
  /** Maximum number of files to keep (default: 10) */
  readonly maxFiles: number;
}

/**
 * AuditTrailWriterConfig — JSONL audit trail writer configuration.
 */
export interface AuditTrailWriterConfig {
  /** Maximum file size in bytes (default: 10_000_000 = 10MB) */
  readonly maxSizeBytes: number;
  /** Maximum number of rotated files (default: 5) */
  readonly maxFiles: number;
}

/**
 * SandboxRpcConfig — RPC handler configuration.
 */
export interface SandboxRpcConfig {
  /** Maximum events per second per plugin (default: 100) */
  readonly rateLimit: number;
}

/**
 * WorkerPoolConfig — worker pool reset configuration.
 */
export interface WorkerPoolResetConfig {
  /** Worker pool reset timeout in ms (default: 5000) */
  readonly resetTimeoutMs: number;
}

/**
 * Default sandbox manager configuration.
 */
export const DEFAULT_SANDBOX_MANAGER_CONFIG: SandboxManagerConfig = {
  memoryLimitMb: 512,
  rpcTimeoutMs: 30000,
  cpuTimeoutMs: 60000,
  heartbeatCheckIntervalMs: 45000,
  restartPolicy: {
    maxRestarts: 3,
    backoffMs: 500,
    maxBackoffMs: 10000,
    resetWindowMs: 60000,
  },
  shutdownTimeoutMs: 5000,
};

/**
 * Default audit logger configuration.
 */
export const DEFAULT_AUDIT_LOGGER_CONFIG: AuditLoggerConfig = {
  maxStringLength: 200,
  maxSanitizeDepth: 3,
  bufferSize: 50,
  flushIntervalMs: 5000,
  maxFileSizeMb: 50,
  maxFiles: 10,
};

/**
 * Default audit trail writer configuration.
 */
export const DEFAULT_AUDIT_TRAIL_WRITER_CONFIG: AuditTrailWriterConfig = {
  maxSizeBytes: 10_000_000,
  maxFiles: 5,
};

/**
 * Default sandbox RPC configuration.
 */
export const DEFAULT_SANDBOX_RPC_CONFIG: SandboxRpcConfig = {
  rateLimit: 100,
};

/**
 * Default worker pool reset configuration.
 */
export const DEFAULT_WORKER_POOL_RESET_CONFIG: WorkerPoolResetConfig = {
  resetTimeoutMs: 5000,
};
