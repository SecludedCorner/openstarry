/**
 * Schema-Drift Policy — central policy module for handling unknown/invalid fields
 * in inbound data (Zod safeParse boundary).
 *
 * Plan49 C49-M3 (R3 D-12 UNANIMOUS):
 *   - SHOULD per-site: each of the 8 spec-enumerated call-sites validates schema on receive.
 *   - C49-M3g process-global MUST: a single process-wide mode is resolved once at boot;
 *     all call-sites read the same mode (no per-site override at runtime).
 *
 * Three modes (SchemaDriftMode):
 *   - `tolerant` (default, backward-compatible): accept + silent strip. safeParse success path
 *     returns parsed data; failure path drops invalid fields and returns the best-effort data
 *     with a formatted error string surfaced to caller for optional logging.
 *   - `strict`: throw SchemaDriftError on any safeParse failure.
 *   - `audited`: accept + strip + emit a structured-log event (hook supplied by caller or no-op
 *     if not wired). Reuses Plan48 C48-M1 structured-log infrastructure when available.
 *
 * MR-6 posture (C49-M3f): this module lives under `apps/runner/src/schema-drift-policy/`,
 * NOT `packages/core/`. Zero Core policy constants added; zero Core import edges.
 *
 * @see docs/EN+TW/schema-drift-policy.md
 * @see share/research_team_suggestion/cycle03-13/deliver/O2_plan49_engineering_spec.md §2.3
 */

import type { ZodType, ZodIssue } from "zod";
import { formatZodError } from "@openstarry/shared";

export type SchemaDriftMode = "tolerant" | "strict" | "audited";

/** Error thrown when mode is `strict` and parse fails. */
export class SchemaDriftError extends Error {
  constructor(
    public readonly context: string,
    public readonly zodIssues: string,
  ) {
    super(`schema-drift (strict): ${context}: ${zodIssues}`);
    this.name = "SchemaDriftError";
  }
}

/** Shape used for audited-mode structured-log event emission. */
export interface SchemaDriftAuditEvent {
  readonly event: "schema_drift_audit";
  readonly timestamp: string;
  readonly context: string;
  readonly mode: SchemaDriftMode;
  readonly zodIssues: string;
  readonly accepted: boolean;
}

/**
 * Sink for audited-mode events. Callers wire this to Plan48 C48-M1
 * structured-log + C48-M2 audit-sink if desired; no-op fallback is allowed.
 */
export type SchemaDriftAuditSink = (event: SchemaDriftAuditEvent) => void;

const NOOP_SINK: SchemaDriftAuditSink = () => {};

let _processSink: SchemaDriftAuditSink = NOOP_SINK;

/** Wire the process-global audit sink. Call once at boot (no-op is the default). */
export function setSchemaDriftAuditSink(sink: SchemaDriftAuditSink | undefined): void {
  _processSink = sink ?? NOOP_SINK;
}

// ─── Process-global mode resolution (C49-M3g) ───

const VALID_MODES: readonly SchemaDriftMode[] = ["tolerant", "strict", "audited"];

let _resolvedMode: SchemaDriftMode | null = null;

/**
 * Resolve the process-global schema-drift mode exactly once from
 * `SCHEMA_DRIFT_MODE` env var. Subsequent calls return the cached value.
 *
 * Defaults to `tolerant` for backward compatibility (Plan49 default per D-12).
 * Unknown values fall back to `tolerant` (non-breaking).
 */
export function resolveSchemaDriftMode(): SchemaDriftMode {
  if (_resolvedMode !== null) return _resolvedMode;
  const raw = process.env.SCHEMA_DRIFT_MODE;
  if (raw && (VALID_MODES as readonly string[]).includes(raw)) {
    _resolvedMode = raw as SchemaDriftMode;
  } else {
    _resolvedMode = "tolerant";
  }
  return _resolvedMode;
}

/**
 * Reset cached mode. For tests only (unit tests that manipulate the env var
 * need this to observe the change).
 *
 * @internal
 */
export function __resetSchemaDriftModeForTests(): void {
  _resolvedMode = null;
}

// ─── Policy application ───

/** One zod issue, flattened path + message for caller reporting. */
export interface SchemaDriftIssue {
  readonly path: string;
  readonly message: string;
}

/** Structured result of {@link applySchemaDriftPolicy}. */
export type SchemaDriftResult<T> =
  | { readonly ok: true; readonly data: T; readonly warnings?: string }
  | { readonly ok: false; readonly error: string; readonly issues: readonly SchemaDriftIssue[] };

/**
 * Apply the process-global schema-drift policy to a Zod parse.
 *
 * Call-sites hand off their `schema.safeParse(input)` to this function instead
 * of branching manually. The policy decides:
 *  - `tolerant`: return `{ ok: true, data }` on success; on failure return
 *    `{ ok: false, error }` so the caller can log/fall-back without throwing.
 *  - `strict`: throw SchemaDriftError on failure.
 *  - `audited`: on failure emit a structured-log event via the wired sink AND
 *    return `{ ok: false, error }` (non-throwing).
 *
 * @param schema Zod schema to validate against.
 * @param input  Unknown payload to parse.
 * @param context Short human-readable origin (e.g., "IAgentConfig", "project-permissions").
 * @param overrideMode  Test-only override. Production callers MUST NOT pass this
 *                      (process-global uniformity per C49-M3g).
 */
export function applySchemaDriftPolicy<T>(
  schema: ZodType<T>,
  input: unknown,
  context: string,
  overrideMode?: SchemaDriftMode,
): SchemaDriftResult<T> {
  const mode = overrideMode ?? resolveSchemaDriftMode();
  const parsed = schema.safeParse(input);

  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }

  const issues: SchemaDriftIssue[] = parsed.error.issues.map((i: ZodIssue) => ({
    path: i.path.map(String).join("."),
    message: i.message,
  }));
  const formatted = formatZodError(parsed.error);

  if (mode === "strict") {
    throw new SchemaDriftError(context, formatted);
  }

  if (mode === "audited") {
    _processSink({
      event: "schema_drift_audit",
      timestamp: new Date().toISOString(),
      context,
      mode,
      zodIssues: formatted,
      accepted: false,
    });
  }

  return { ok: false, error: formatted, issues };
}

