/**
 * Buffered audit logger for sandbox operations.
 * Writes structured JSONL logs with automatic rotation and sanitization.
 */

import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { EventBus, AuditLogEntry } from "@openstarry/sdk";
import { AgentEventType } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("AuditLogger");

const SECRET_PATTERN = /secret|token|password|key|auth|credential/i;
const MAX_STRING_LENGTH = 200;
const MAX_SANITIZE_DEPTH = 3;

export interface AuditLoggerOptions {
  /** Plugin name (used in filename) */
  pluginName: string;

  /** Log directory */
  logDir: string;

  /** Buffer size before flush. Default: 50 */
  bufferSize?: number;

  /** Flush interval in milliseconds. Default: 5000 */
  flushIntervalMs?: number;

  /** Maximum file size in MB. Default: 50 */
  maxFileSizeMb?: number;

  /** Maximum number of files to keep. Default: 10 */
  maxFiles?: number;

  /** Sanitize arguments. Default: true */
  sanitizeArgs?: boolean;

  /** EventBus for emitting audit events (optional) */
  bus?: EventBus;
}

/** Sanitize a value by redacting secrets and truncating long strings. */
export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_SANITIZE_DEPTH) return "[depth limit]";

  if (value === null || value === undefined) return value;
  if (typeof value === "boolean" || typeof value === "number") return value;

  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      return value.slice(0, MAX_STRING_LENGTH) + "... [truncated]";
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((v) => sanitizeValue(v, depth + 1));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_PATTERN.test(k)) {
        result[k] = "[REDACTED]";
      } else {
        result[k] = sanitizeValue(v, depth + 1);
      }
    }
    return result;
  }

  return String(value);
}

export class AuditLogger {
  private buffer: AuditLogEntry[] = [];
  private stream: WriteStream | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private currentFileSize = 0;
  private currentFilePath = "";
  private disposed = false;
  private dirReady = false;

  private readonly pluginName: string;
  private readonly logDir: string;
  private readonly bufferSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxFileSizeMb: number;
  private readonly maxFiles: number;
  private readonly shouldSanitize: boolean;
  private readonly bus?: EventBus;

  // Pending RPC operations (operationId -> startTime)
  private readonly pendingOps = new Map<string, number>();
  private opCounter = 0;

  constructor(options: AuditLoggerOptions) {
    this.pluginName = options.pluginName;
    this.logDir = options.logDir;
    this.bufferSize = options.bufferSize ?? 50;
    this.flushIntervalMs = options.flushIntervalMs ?? 5000;
    this.maxFileSizeMb = options.maxFileSizeMb ?? 50;
    this.maxFiles = options.maxFiles ?? 10;
    this.shouldSanitize = options.sanitizeArgs ?? true;
    this.bus = options.bus;

    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    this.flushTimer.unref();
  }

  /** Log an RPC operation start. Returns an operation ID for matching with logRpcEnd. */
  logRpcStart(operation: string, method?: string, args?: Record<string, unknown>): string {
    const operationId = `op-${++this.opCounter}-${Date.now()}`;
    this.pendingOps.set(operationId, Date.now());

    this.addEntry({
      timestamp: new Date().toISOString(),
      level: "audit",
      pluginName: this.pluginName,
      category: "rpc",
      operation,
      method,
      args: this.shouldSanitize && args ? sanitizeValue(args) as Record<string, unknown> : args,
    });

    return operationId;
  }

  /** Log an RPC operation completion. */
  logRpcEnd(operationId: string, result: "success" | "error", error?: string): void {
    const startTime = this.pendingOps.get(operationId);
    this.pendingOps.delete(operationId);
    const durationMs = startTime ? Date.now() - startTime : undefined;

    this.addEntry({
      timestamp: new Date().toISOString(),
      level: result === "error" ? "error" : "audit",
      pluginName: this.pluginName,
      category: "rpc",
      operation: "rpc_end",
      result,
      error,
      durationMs,
    });
  }

  /** Log a worker lifecycle event. */
  logWorkerEvent(
    operation: "spawn" | "crash" | "restart" | "shutdown" | "stalled",
    metadata?: Record<string, unknown>,
  ): void {
    this.addEntry({
      timestamp: new Date().toISOString(),
      level: operation === "crash" || operation === "stalled" ? "error" : "info",
      pluginName: this.pluginName,
      category: "worker",
      operation,
      metadata: this.shouldSanitize && metadata
        ? sanitizeValue(metadata) as AuditLogEntry["metadata"]
        : metadata as AuditLogEntry["metadata"],
    });
  }

  /** Log a tool invocation. */
  logToolInvocation(
    toolId: string,
    input: unknown,
    result: "success" | "error",
    durationMs: number,
    error?: string,
  ): void {
    this.addEntry({
      timestamp: new Date().toISOString(),
      level: result === "error" ? "error" : "audit",
      pluginName: this.pluginName,
      category: "tool",
      operation: "invokeTool",
      method: toolId,
      args: this.shouldSanitize
        ? sanitizeValue({ toolId, input }) as Record<string, unknown>
        : { toolId, input: input as Record<string, unknown> },
      result,
      error,
      durationMs,
    });
  }

  /** Log a module interception event. */
  logModuleBlocked(moduleName: string, parentFile?: string): void {
    this.addEntry({
      timestamp: new Date().toISOString(),
      level: "warn",
      pluginName: this.pluginName,
      category: "lifecycle",
      operation: "module_blocked",
      args: { moduleName, parentFile },
    });
  }

  /** Flush buffered entries to disk immediately. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entries = this.buffer.splice(0);

    try {
      await this.ensureDir();
      const stream = await this.getStream();

      for (const entry of entries) {
        const line = JSON.stringify(entry) + "\n";
        const byteLen = Buffer.byteLength(line, "utf-8");

        // Wait for the write to complete (backpressure-aware)
        const ok = stream.write(line);
        if (!ok) {
          await new Promise<void>((resolve) => stream.once("drain", resolve));
        }

        this.currentFileSize += byteLen;

        // Check if rotation is needed
        if (this.currentFileSize >= this.maxFileSizeMb * 1024 * 1024) {
          await this.rotate();
        }
      }

      // Ensure all data is flushed to the OS
      await new Promise<void>((resolve, reject) => {
        if (!stream.writableNeedDrain) {
          resolve();
        } else {
          stream.once("drain", resolve);
          stream.once("error", reject);
        }
      });
    } catch (err) {
      logger.error("Failed to flush audit log", { error: String(err), plugin: this.pluginName });
      this.bus?.emit({
        type: AgentEventType.SANDBOX_AUDIT_LOG_ERROR,
        timestamp: Date.now(),
        payload: {
          pluginName: this.pluginName,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  /** Dispose of the logger (flush and close stream). */
  async dispose(): Promise<void> {
    if (this.disposed) return;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining buffer before marking as disposed
    await this.flush();
    this.disposed = true;

    if (this.stream) {
      await new Promise<void>((resolve) => {
        this.stream!.end(() => resolve());
      });
      this.stream = null;
    }
  }

  private addEntry(entry: AuditLogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length >= this.bufferSize) {
      void this.flush();
    }
  }

  private async ensureDir(): Promise<void> {
    if (this.dirReady) return;
    await mkdir(this.logDir, { recursive: true });
    this.dirReady = true;
  }

  private async getStream(): Promise<WriteStream> {
    if (this.stream) return this.stream;

    const filename = `${this.pluginName}-${Date.now()}.jsonl`;
    this.currentFilePath = join(this.logDir, filename);
    this.currentFileSize = 0;

    this.stream = createWriteStream(this.currentFilePath, { flags: "a" });

    // Wait for stream to open (file creation is async)
    await new Promise<void>((resolve, reject) => {
      this.stream!.once("open", () => resolve());
      this.stream!.once("error", reject);
    });

    return this.stream;
  }

  private async rotate(): Promise<void> {
    // Close current stream
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }

    // Emit rotation event
    this.bus?.emit({
      type: AgentEventType.SANDBOX_AUDIT_LOG_ROTATED,
      timestamp: Date.now(),
      payload: {
        pluginName: this.pluginName,
        rotatedFile: this.currentFilePath,
      },
    });

    // Open new stream (will happen lazily on next getStream call)

    // Clean up old files
    await this.cleanupOldFiles();
  }

  private async cleanupOldFiles(): Promise<void> {
    try {
      const files = await readdir(this.logDir);
      const pluginFiles = files
        .filter((f) => f.startsWith(this.pluginName + "-") && f.endsWith(".jsonl"))
        .sort(); // Sorted by timestamp (embedded in filename)

      if (pluginFiles.length > this.maxFiles) {
        const toDelete = pluginFiles.slice(0, pluginFiles.length - this.maxFiles);
        for (const file of toDelete) {
          await unlink(join(this.logDir, file));
        }
      }
    } catch (err) {
      logger.warn("Failed to cleanup old audit log files", { error: String(err) });
    }
  }
}
