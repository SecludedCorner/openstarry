/**
 * audit-infra/env-parse — W0 Plan48 shared infra.
 *
 * Minimal env-var parsing helpers with validation. Shared by structured-log
 * (LOG_LEVEL), audit-sink (AUDIT_SINK_PATH), and hmac-cleanup (OPENSTARRY_*
 * HMAC env vars). Keeps env reads consistent across Plan48 modules.
 *
 * Layer: Runner (NOT Core; MR-6 preserved).
 *
 * @since Plan48 W0 shared infra
 */

export function envString(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw;
}

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== raw.trim()) {
    return fallback;
  }
  return parsed;
}

export function envEnum<T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const upper = raw.toUpperCase() as T;
  return (allowed as readonly string[]).includes(upper) ? upper : fallback;
}
