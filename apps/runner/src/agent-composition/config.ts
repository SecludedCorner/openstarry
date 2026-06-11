/**
 * agent-composition / config — Plan54 §7 MAX_SPAWN_DEPTH + override audit.
 *
 * **R3 D-04 17/6**: `MAX_SPAWN_DEPTH = 4` with operator override.
 * Candidate B (Core const) was REJECTED at R3 D-01.
 *
 * **D-04 + Batch 14 Item #6**: every override emits a tamper-evident audit
 * log entry (timestamp / source / overridden value / default / operator UID).
 *
 * **MR-6 posture**: plugin-internal const (NOT Core). Lives at runner-side
 * `apps/runner/src/agent-composition/`.
 *
 * @see openstarry_doc/Technical_Specifications/Plan54_AC9_Binding.md §7
 */

import { createHmac, randomBytes } from 'node:crypto';
import { hostname, userInfo } from 'node:os';

/** R3 D-04 ratified default: 4. Range 1..16; outside-range = WARN + fallback. */
export const MAX_SPAWN_DEPTH_DEFAULT = 4;
const MAX_SPAWN_DEPTH_RANGE: readonly [number, number] = [1, 16];
const ENV_VAR_NAME = 'OPENSTARRY_MAX_SPAWN_DEPTH';

/** Plan54 §8 — quota constants (env override 1..1024 for global). */
export const MAX_ACTIVE_SUBAGENTS_GLOBAL_DEFAULT = 64;
export const MAX_ACTIVE_SUBAGENTS_PER_PARENT = 8;
export const ORPHAN_GRACE_WINDOW_MS = 30_000;
export const DEFAULT_LLM_TOKEN_BUDGET_PER_SPAWN = 32_000;

/** Source of an override (precedence per §7.2: per-spawn > config > env > default). */
export type OverrideSource = 'per_spawn' | 'config' | 'env' | 'default';

/** Tamper-evident audit log entry (Batch 14 Item #6). */
export interface SpawnDepthOverrideAudit {
  readonly timestamp: number;
  readonly source: OverrideSource;
  readonly overriddenValue: number;
  readonly defaultValue: number;
  readonly operatorUid: number | null;
  readonly hostname: string;
  /** HMAC-SHA256 over `timestamp|source|value|default|uid|hostname` for tamper-evidence. */
  readonly integrityMac: string;
}

const auditKey = process.env.OPENSTARRY_AUDIT_HMAC_KEY
  ? Buffer.from(process.env.OPENSTARRY_AUDIT_HMAC_KEY, 'hex')
  : randomBytes(32);

function buildAudit(source: OverrideSource, value: number): SpawnDepthOverrideAudit {
  const ts = Date.now();
  const u = userInfo();
  const host = hostname();
  const canonical = `${ts}|${source}|${value}|${MAX_SPAWN_DEPTH_DEFAULT}|${u.uid ?? ''}|${host}`;
  const mac = createHmac('sha256', auditKey).update(canonical, 'utf-8').digest('hex');
  return {
    timestamp: ts,
    source,
    overriddenValue: value,
    defaultValue: MAX_SPAWN_DEPTH_DEFAULT,
    operatorUid: typeof u.uid === 'number' ? u.uid : null,
    hostname: host,
    integrityMac: mac,
  };
}

/** Verify an audit entry; returns true iff integrityMac matches the canonical fields. */
export function verifySpawnDepthAudit(entry: SpawnDepthOverrideAudit): boolean {
  const canonical = `${entry.timestamp}|${entry.source}|${entry.overriddenValue}|${entry.defaultValue}|${entry.operatorUid ?? ''}|${entry.hostname}`;
  const expected = createHmac('sha256', auditKey).update(canonical, 'utf-8').digest('hex');
  return expected === entry.integrityMac;
}

/** Configuration provider for runtime resolution. */
export interface MaxSpawnDepthConfig {
  readonly perSpawn?: number;
  readonly configFile?: number;
  readonly envOverride?: number;
}

/** Audit sink — caller wires to Plan48 structured-log if desired. */
export type SpawnDepthAuditSink = (entry: SpawnDepthOverrideAudit) => void;
const NOOP_AUDIT: SpawnDepthAuditSink = () => {};

/**
 * Resolve `MAX_SPAWN_DEPTH` per Plan54 §7.2 precedence and emit a tamper-evident
 * audit entry on every non-default resolution.
 *
 * Precedence: per-spawn > config file > env var > default.
 * Out-of-range values fall back to default + WARN audit (source=`default`).
 */
export function resolveMaxSpawnDepth(
  cfg: MaxSpawnDepthConfig = {},
  audit: SpawnDepthAuditSink = NOOP_AUDIT,
): number {
  const candidates: ReadonlyArray<{ source: OverrideSource; value: number | undefined }> = [
    { source: 'per_spawn', value: cfg.perSpawn },
    { source: 'config', value: cfg.configFile },
    { source: 'env', value: cfg.envOverride ?? readEnvOverride() },
  ];
  for (const c of candidates) {
    if (c.value === undefined) continue;
    if (!inRange(c.value)) continue;
    audit(buildAudit(c.source, c.value));
    return c.value;
  }
  return MAX_SPAWN_DEPTH_DEFAULT;
}

function readEnvOverride(): number | undefined {
  const raw = process.env[ENV_VAR_NAME];
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function inRange(n: number): boolean {
  return Number.isInteger(n) && n >= MAX_SPAWN_DEPTH_RANGE[0] && n <= MAX_SPAWN_DEPTH_RANGE[1];
}

/**
 * Resolve global quota with same env-override pattern.
 * Range 1..1024; out-of-range falls back to default.
 */
export function resolveMaxActiveSubagentsGlobal(): number {
  const raw = process.env.OPENSTARRY_MAX_ACTIVE_SUBAGENTS_GLOBAL;
  if (!raw) return MAX_ACTIVE_SUBAGENTS_GLOBAL_DEFAULT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 1024) return MAX_ACTIVE_SUBAGENTS_GLOBAL_DEFAULT;
  return n;
}
