/**
 * audit-infra/iso-timestamp — W0 Plan48 shared infra.
 *
 * ISO-8601 timestamp utility. Isolated so tests can stub `Date.now()`
 * deterministically without overriding Node globals in every caller.
 *
 * @since Plan48 W0 shared infra
 */

export function isoTimestamp(now: number = Date.now()): string {
  return new Date(now).toISOString();
}
