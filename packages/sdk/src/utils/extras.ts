/**
 * extras SDK helpers — validate keys and provide type-safe access.
 *
 * WIENER C-3: 'audit:', 'core:', 'internal:' prefixes are forbidden.
 *
 * @see Plan30 Wave 3, Doc 46 §3
 * @module extras
 */

import type { AgentEvent, EventBus } from "../types/events.js";

export const EXTRAS_MAX_KEYS = 32;
export const EXTRAS_MAX_KEY_LENGTH = 128;
export const EXTRAS_FORBIDDEN_PREFIXES: readonly string[] = [
  'audit:',
  'core:',
  'internal:',
];

/**
 * Validate whether an extras key is legal.
 */
export function isValidExtrasKey(
  key: string,
  currentSize: number = 0,
): boolean {
  if (typeof key !== 'string' || key.length === 0) return false;
  if (key.length > EXTRAS_MAX_KEY_LENGTH) return false;
  if (currentSize >= EXTRAS_MAX_KEYS) return false;
  const lowerKey = key.toLowerCase();
  for (const prefix of EXTRAS_FORBIDDEN_PREFIXES) {
    if (lowerKey.startsWith(prefix)) return false;
  }
  return true;
}

/**
 * Type-safe accessor for extras values.
 */
export function getExtra<T>(
  extras: ReadonlyMap<string, unknown> | Record<string, unknown> | undefined,
  key: string,
  guard: (v: unknown) => v is T,
): T | undefined {
  if (!extras) return undefined;
  const value = extras instanceof Map ? extras.get(key) : (extras as Record<string, unknown>)[key];
  if (value === undefined) return undefined;
  return guard(value) ? value : undefined;
}

/**
 * Emit an AgentEvent with validated extras attached.
 * Invalid keys are silently dropped.
 */
export function emitWithExtras(
  bus: EventBus,
  base: Omit<AgentEvent, 'extras'>,
  extras: Array<{ key: string; value: unknown }>,
): void {
  const validExtras: Record<string, unknown> = {};
  let count = 0;
  for (const { key, value } of extras) {
    if (count >= EXTRAS_MAX_KEYS) break;
    if (isValidExtrasKey(key, count)) {
      validExtras[key] = value;
      count++;
    }
  }
  bus.emit({
    ...base,
    extras: count > 0 ? validExtras : undefined,
  } as AgentEvent);
}
