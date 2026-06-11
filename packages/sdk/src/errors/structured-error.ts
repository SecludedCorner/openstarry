/**
 * structured-error — F-16 ENG-FAB v1.9 candidate StructuredError schema.
 *
 * SHOULD-applicable to new code in `apps/runner` and new plugins (cycle 03-14+
 * authoring). Per MR-12, existing partial-pattern code is NOT retrofitted.
 *
 * SHOULD → MUST advancement scheduled at cycle 03-17 Plan if 2-cycle (03-15 +
 * 03-16) observation metrics ≥ 80% (adoption / field-completion / prefix
 * discipline) per F-16 spec D-§4-03.
 *
 * Transport binding (D-§4-04 UNANIMOUS): F-16 emissions flow through the
 * Plan48 structured-log channel as a payload type. F-16 is NOT a parallel
 * emission channel.
 *
 * @see openstarry_doc/Research_Methodology/15_ENG_FAB_v1.9_F_16_StructuredError.md
 */

/** Closed enum of F-16 error discriminators (10 constants per D-§4-01 UNANIMOUS). */
export const StructuredErrorCode = {
  /** Input failed schema/structural validation. */
  ValidationError: 'ValidationError',
  /** Requested resource/identifier not present. */
  NotFound: 'NotFound',
  /** State conflict (concurrent update, version mismatch). */
  Conflict: 'Conflict',
  /** Downstream dependency (HMAC verify, plugin load, etc.) failed. */
  DependencyFailure: 'DependencyFailure',
  /** Time-bounded operation exceeded budget. */
  TimeoutError: 'TimeoutError',
  /** Authorisation/capability check failed. */
  PermissionDenied: 'PermissionDenied',
  /** Unanticipated runtime error (catch-all internal). */
  InternalError: 'InternalError',
  /** Plan49 class — observed schema disagrees with declared. */
  SchemaDriftDetected: 'SchemaDriftDetected',
  /** Cycle-halt-class event (sustained, not ephemeral; e.g. audit halt). */
  Halt: 'Halt',
  /** Genuinely-unclassified-at-emit-time; reader should not branch on it. */
  Other: 'Other',
} as const;

/** Type-level enumeration of `error` field values. */
export type StructuredErrorCodeValue =
  (typeof StructuredErrorCode)[keyof typeof StructuredErrorCode];

/**
 * Madhyamaka-coherent fallback rule (NAGARJUNA caveat absorbed at R3 UNANIMOUS):
 * parsers operating on schema version v_N MUST treat any discriminator not in
 * v_N as semantically equivalent to `Other`. Implements graceful degradation.
 */
export function normalizeErrorCode(raw: string): StructuredErrorCodeValue {
  if (raw in StructuredErrorCode) {
    return StructuredErrorCode[raw as keyof typeof StructuredErrorCode];
  }
  return StructuredErrorCode.Other;
}

/**
 * Prefix-discipline tags for `likely_cause` field (D-§4-02 19/2/2).
 *
 * ASANGA Yogācāra epistemic-status awareness in machine-readable form:
 * - `verified:` — author confirmed the cause by reproduction (sampajāna).
 * - `inferred:` — strong evidence but no direct reproduction (anumāna).
 * - `speculation:` — author's best guess (kalpanā).
 *
 * Sentinel `speculation: unknown` REQUIRED when no cause hypothesis exists.
 */
export const LikelyCausePrefix = {
  Verified: 'verified:',
  Inferred: 'inferred:',
  Speculation: 'speculation:',
} as const;

export type LikelyCausePrefixValue =
  (typeof LikelyCausePrefix)[keyof typeof LikelyCausePrefix];

/** Sentinel string for an empty cause hypothesis (per F-16 §3.3). */
export const LIKELY_CAUSE_UNKNOWN = 'speculation: unknown' as const;

/** Sentinel string for an unknown fix location (per F-16 §3.1). */
export const SUGGESTED_FIX_LOCATION_UNKNOWN = 'unknown' as const;

/** Maximum allowed length for `message` and `likely_cause` fields. */
export const STRUCTURED_ERROR_MESSAGE_MAX_LENGTH = 200;

/**
 * F-16 StructuredError record — 6 fields per F-16 §3.1.
 *
 * Transport-bound to Plan48 structured-log channel; emit via the existing
 * structured-log infrastructure with this object as payload.
 */
export interface StructuredError {
  /** Discriminator from the closed 10-enum. */
  readonly error: StructuredErrorCodeValue;
  /** Human-readable, single sentence, ≤ 200 chars. */
  readonly message: string;
  /** Prefix-disciplined cause hypothesis; ≤ 200 chars; sentinel allowed. */
  readonly likely_cause: string;
  /** Relative file path + optional line range, OR the literal "unknown". */
  readonly suggested_fix_location: string;
  /** Relevant identifiers (plan_id, request_id, trace_id, etc.). */
  readonly context: Record<string, unknown>;
  /**
   * Opaque correlation id; structured-log existing trace id when present
   * (single source of truth — F-16 defers to Plan48's trace correlation).
   */
  readonly trace_id: string;
}

/**
 * Validate a `likely_cause` string against the prefix discipline.
 * Returns the matched prefix or null if non-conforming.
 */
export function validateLikelyCausePrefix(
  likelyCause: string,
): LikelyCausePrefixValue | null {
  if (likelyCause.startsWith(LikelyCausePrefix.Verified)) return LikelyCausePrefix.Verified;
  if (likelyCause.startsWith(LikelyCausePrefix.Inferred)) return LikelyCausePrefix.Inferred;
  if (likelyCause.startsWith(LikelyCausePrefix.Speculation)) return LikelyCausePrefix.Speculation;
  return null;
}

/** Construct a prefix-disciplined `likely_cause` string. */
export function formatLikelyCause(
  prefix: LikelyCausePrefixValue,
  cause: string,
): string {
  const trimmed = cause.trim();
  if (trimmed.length === 0) return LIKELY_CAUSE_UNKNOWN;
  // prefix already ends with ":"
  return `${prefix} ${trimmed}`;
}

/**
 * Build a StructuredError record with field-level validation.
 *
 * Throws when the schema is violated (caller passed bad data — synchronous
 * fail-loud per ENG-FAB F-13 binding; we do not silently coerce).
 */
export function buildStructuredError(args: {
  readonly error: StructuredErrorCodeValue;
  readonly message: string;
  readonly likely_cause: string;
  readonly suggested_fix_location: string;
  readonly context?: Record<string, unknown>;
  readonly trace_id: string;
}): StructuredError {
  if (args.message.length === 0 || args.message.length > STRUCTURED_ERROR_MESSAGE_MAX_LENGTH) {
    throw new Error(
      `StructuredError.message must be 1..${STRUCTURED_ERROR_MESSAGE_MAX_LENGTH} chars (got ${args.message.length})`,
    );
  }
  if (args.likely_cause.length > STRUCTURED_ERROR_MESSAGE_MAX_LENGTH) {
    throw new Error(
      `StructuredError.likely_cause must be ≤ ${STRUCTURED_ERROR_MESSAGE_MAX_LENGTH} chars (got ${args.likely_cause.length})`,
    );
  }
  if (validateLikelyCausePrefix(args.likely_cause) === null) {
    throw new Error(
      `StructuredError.likely_cause must start with one of "verified:" / "inferred:" / "speculation:"` +
      ` (got: ${args.likely_cause.slice(0, 40)}...)`,
    );
  }
  if (args.trace_id.length === 0) {
    throw new Error('StructuredError.trace_id must be non-empty');
  }
  return {
    error: args.error,
    message: args.message,
    likely_cause: args.likely_cause,
    suggested_fix_location: args.suggested_fix_location,
    context: args.context ?? {},
    trace_id: args.trace_id,
  };
}
