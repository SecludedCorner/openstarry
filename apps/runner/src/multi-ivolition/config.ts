/**
 * multi-ivolition / config — Plan56 §7.2 + Batch 15 Item #6 A8.
 *
 * **R3 A8 20/2/1**: `OPENSTARRY_MAX_VOLITION_QUEUE` env var override with
 * per-cognitive-moment cap.
 *
 * **DSS-CY18-03 dissent preserved** (LEIBNIZ + RUSSELL, 2 votes; preferred no
 * env var at first-shipping). Implementation guidance: env var documented as
 * advanced-operator surface; cycle 03-19+ may revisit.
 *
 * **Batch 15 Item #6 A8 default**: 16 (≥ 8, ≤ 64 safety band per Plan56 §7.2).
 *
 * @see research record/cycle03-18/deliver/O1_D30_4_Plan56_implementation_final.md §7.2
 */

import { createHmac, randomBytes } from 'node:crypto';
import { hostname, userInfo } from 'node:os';

/** Default per-moment volition queue cap (within ≥8/≤64 safety band). */
export const MAX_VOLITION_QUEUE_DEFAULT = 16;
const QUEUE_RANGE: readonly [number, number] = [1, 256];
const ENV_VAR_NAME = 'OPENSTARRY_MAX_VOLITION_QUEUE';

/** Source of an override (precedence: env > default). */
export type VolitionQueueOverrideSource = 'env' | 'default';

/** Tamper-evident audit log entry inheriting cycle 03-17 §5.3 pattern. */
export interface VolitionQueueOverrideAudit {
  readonly timestamp: number;
  readonly source: VolitionQueueOverrideSource;
  readonly resolvedValue: number;
  readonly rawEnv: string | null;
  readonly defaultValue: number;
  readonly outOfRange: boolean;
  readonly operatorUid: number | null;
  readonly hostname: string;
  /** HMAC-SHA256 over canonical fields for tamper-evidence (Item #6 inheritance). */
  readonly integrityMac: string;
}

const auditKey = process.env.OPENSTARRY_AUDIT_HMAC_KEY
  ? Buffer.from(process.env.OPENSTARRY_AUDIT_HMAC_KEY, 'hex')
  : randomBytes(32);

function buildAudit(
  source: VolitionQueueOverrideSource,
  resolvedValue: number,
  rawEnv: string | null,
  outOfRange: boolean,
): VolitionQueueOverrideAudit {
  const ts = Date.now();
  const u = userInfo();
  const host = hostname();
  const canonical = `${ts}|${source}|${resolvedValue}|${rawEnv ?? ''}|${MAX_VOLITION_QUEUE_DEFAULT}|${outOfRange ? 1 : 0}|${u.uid ?? ''}|${host}`;
  const mac = createHmac('sha256', auditKey).update(canonical, 'utf-8').digest('hex');
  return {
    timestamp: ts,
    source,
    resolvedValue,
    rawEnv,
    defaultValue: MAX_VOLITION_QUEUE_DEFAULT,
    outOfRange,
    operatorUid: typeof u.uid === 'number' ? u.uid : null,
    hostname: host,
    integrityMac: mac,
  };
}

/** Verify an audit entry; returns true iff integrityMac matches canonical. */
export function verifyVolitionQueueAudit(entry: VolitionQueueOverrideAudit): boolean {
  const canonical = `${entry.timestamp}|${entry.source}|${entry.resolvedValue}|${entry.rawEnv ?? ''}|${entry.defaultValue}|${entry.outOfRange ? 1 : 0}|${entry.operatorUid ?? ''}|${entry.hostname}`;
  const expected = createHmac('sha256', auditKey).update(canonical, 'utf-8').digest('hex');
  return expected === entry.integrityMac;
}

/** Audit sink — caller wires to canonical logger if desired. */
export type VolitionQueueAuditSink = (entry: VolitionQueueOverrideAudit) => void;
const NOOP_AUDIT: VolitionQueueAuditSink = () => {};

/**
 * Resolve `MAX_VOLITION_QUEUE` per Plan56 §7.2 precedence and emit a
 * tamper-evident audit entry on every non-default resolution + every
 * out-of-range fallback (per A8 ratification 20/2/1).
 *
 * Precedence: env > default. Out-of-range values fall back to default + emit
 * `VOLITION_QUEUE_OUT_OF_RANGE` structured-error audit per A8 §7.2.
 */
export function resolveMaxVolitionQueue(audit: VolitionQueueAuditSink = NOOP_AUDIT): number {
  const raw = process.env[ENV_VAR_NAME];
  if (raw === undefined || raw === '') return MAX_VOLITION_QUEUE_DEFAULT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < QUEUE_RANGE[0] || n > QUEUE_RANGE[1]) {
    audit(buildAudit('default', MAX_VOLITION_QUEUE_DEFAULT, raw, true));
    return MAX_VOLITION_QUEUE_DEFAULT;
  }
  audit(buildAudit('env', n, raw, false));
  return n;
}
