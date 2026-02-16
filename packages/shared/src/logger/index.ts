/**
 * Structured logger with JSON output support.
 *
 * Features:
 * - JSON-structured log entries (when LOG_FORMAT=json)
 * - Log level filtering via LOG_LEVEL env var
 * - agent_id and trace_id fields for observability
 * - Child loggers inherit context
 */

import { performance } from "node:perf_hooks";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogContext {
  agentId?: string;
  traceId?: string;
  sessionId?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  child(name: string): Logger;
  /** Set persistent context fields (agentId, traceId, etc.) */
  setContext(ctx: LogContext): void;
  /** Start a timer. Returns a stop function that logs elapsed time and returns duration in ms. */
  time(label: string): () => number;
}

/** Resolve min log level from environment. */
function resolveMinLevel(explicit?: LogLevel): LogLevel {
  if (explicit) return explicit;
  const env = (typeof process !== "undefined" && process.env?.LOG_LEVEL) || "";
  const normalized = env.toLowerCase() as LogLevel;
  if (normalized in LEVEL_PRIORITY) return normalized;
  return "info";
}

/** Check if JSON output is requested. */
function isJsonFormat(): boolean {
  return (
    typeof process !== "undefined" &&
    process.env?.LOG_FORMAT?.toLowerCase() === "json"
  );
}

export function createLogger(
  name: string,
  minLevel?: LogLevel,
  parentContext?: LogContext,
): Logger {
  const minPriority = LEVEL_PRIORITY[resolveMinLevel(minLevel)];
  const useJson = isJsonFormat();
  let context: LogContext = { ...parentContext };

  function log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (LEVEL_PRIORITY[level] < minPriority) return;

    const timestamp = new Date().toISOString();

    if (useJson) {
      const entry: Record<string, unknown> = {
        timestamp,
        level,
        module: name,
        message,
      };
      if (context.agentId) entry.agent_id = context.agentId;
      if (context.traceId) entry.trace_id = context.traceId;
      if (context.sessionId) entry.session_id = context.sessionId;
      if (data && Object.keys(data).length > 0) {
        Object.assign(entry, data);
      }
      console.error(JSON.stringify(entry));
    } else {
      const prefix = `[${timestamp}] [${level.toUpperCase()}] [${name}]`;
      if (data && Object.keys(data).length > 0) {
        const extra = JSON.stringify(data);
        console.error(`${prefix} ${message} ${extra}`);
      } else {
        console.error(`${prefix} ${message}`);
      }
    }
  }

  return {
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => log("error", msg, data),
    child: (childName) =>
      createLogger(`${name}:${childName}`, resolveMinLevel(minLevel), {
        ...context,
      }),
    setContext(ctx: LogContext): void {
      context = { ...context, ...ctx };
    },
    time(label: string): () => number {
      const start = performance.now();
      return () => {
        const durationMs = Math.round((performance.now() - start) * 100) / 100;
        log("debug", `${label} completed`, { label, durationMs });
        return durationMs;
      };
    },
  };
}
