/**
 * hmac-cleanup — Plan48 C48-M3 E-5 MUST elevation (dual-track per D-14c).
 *
 * Captures HMAC key material into a closure at startup, zeroes the env-var
 * value, wraps shutdown-signing so the key is consumed and cleared before
 * process exit. Scope qualifier: **within-process scope** (D-12b) — the
 * adversary threat model assumes absence of in-process memory read.
 *
 * Layer: Runner startup + shutdown path (NOT Core; MR-6 preserved).
 *
 * Compliance mapping:
 *   - OWASP ASVS V2.10.1 — "Verify that secrets are not kept in resident
 *     memory longer than necessary."
 *   - NIST SP 800-57 Part 1 §8.2.2 — "when a cryptographic key is no
 *     longer needed, it shall be destroyed."
 *
 * Plan48 §2.3 explicitly EXCLUDES runtime key rotation (D-17a); see
 * `docs/EN/hmac-key-rotation-architecture.md` for the design spec.
 *
 * @since Plan48 C48-M3
 */

import { createHmac } from 'node:crypto';
import {
  SHUTDOWN_ORDER,
  type ShutdownHookRegistry,
} from '../audit-infra/shutdown-hooks.js';
import { HMAC_ENV_VAR_NAMES } from './policy.js';

export interface HmacCleanupBinding {
  /** True once the key has been read + env cleared. */
  readonly captured: boolean;
  /** True once `consumeAndClear()` has run (shutdown sign complete). */
  readonly cleared: boolean;
  /**
   * Sign a payload with the captured key using HMAC-SHA256. Throws if the
   * key has already been cleared — by design, callers must sign before
   * the shutdown cascade clears the closure.
   */
  sign(payload: string): string;
  /**
   * HMAC-SHA256 over arbitrary binary material, returning the raw digest.
   * Used to drive checkpoint signing/verification (snapshot-hmac's
   * SnapshotHmacSigner) without ever exposing the plaintext key. When a
   * `normalize` function was supplied to {@link captureHmacKey}, the key is
   * normalized (hex/base64 decode + length check) the same way the legacy
   * key path did, so digests are byte-identical to keySigner(rawKey).
   * Throws once the key has been cleared.
   */
  digest(material: Buffer): Buffer;
  /**
   * Clear the closure-held key. Called by the shutdown hook after the
   * final shutdown signing completes. Idempotent.
   */
  clear(): void;
}

export interface CaptureHmacKeyOptions {
  /** Override env-var precedence (default: HMAC_ENV_VAR_NAMES order). */
  readonly envNames?: readonly string[];
  /** Provide the key directly (test / CLI injection); env is skipped. */
  readonly directKey?: string;
  /**
   * Optional key normalizer used by {@link HmacCleanupBinding.digest} — decodes
   * hex/base64 and enforces a minimum length, exactly as the snapshot-hmac key
   * path does. Supply `normalizeHmacKey` here so checkpoint digests match
   * keySigner(rawKey). When omitted, `digest` HMACs the raw key bytes (utf-8).
   * May throw (e.g. key too short); `digest` propagates that so callers can
   * fail-closed.
   */
  readonly normalize?: (raw: string) => Buffer;
}

/**
 * Read the HMAC key from the configured env var, stash it in a closure, and
 * zero the env-var value so subsequent `process.env[...]` reads return an
 * empty string. Returns `null` when no key is configured — callers decide
 * fallback behaviour (e.g., leave checkpoint signing disabled).
 */
export function captureHmacKey(
  opts: CaptureHmacKeyOptions = {},
): HmacCleanupBinding | null {
  let key: string | null = null;

  if (opts.directKey !== undefined && opts.directKey !== '') {
    key = opts.directKey;
  } else {
    const names = opts.envNames ?? HMAC_ENV_VAR_NAMES;
    for (const name of names) {
      const raw = process.env[name];
      if (raw !== undefined && raw !== '') {
        key = raw;
        // Zero the env-var value immediately so heap scans / child-process
        // inherits / subsequent ctx leaks cannot re-derive the plaintext.
        process.env[name] = '';
        delete process.env[name];
        break;
      }
    }
  }

  if (key === null) return null;

  let captured = true;
  let cleared = false;
  let closureKey: string | null = key;

  // Intentionally shadow the outer `key` to remove the local-scope reference.
  key = null;

  const normalize = opts.normalize;

  return Object.freeze({
    get captured() { return captured; },
    get cleared() { return cleared; },
    sign(payload: string): string {
      if (closureKey === null) {
        throw new Error('hmac-cleanup: key already cleared; sign before shutdown cascade');
      }
      return createHmac('sha256', closureKey).update(payload, 'utf-8').digest('hex');
    },
    digest(material: Buffer): Buffer {
      if (closureKey === null) {
        throw new Error('hmac-cleanup: key already cleared; sign before shutdown cascade');
      }
      const keyMaterial = normalize ? normalize(closureKey) : Buffer.from(closureKey, 'utf-8');
      return createHmac('sha256', keyMaterial).update(material).digest();
    },
    clear(): void {
      if (closureKey !== null) {
        // Overwrite before nulling — defence-in-depth against engines
        // that keep short strings interned. Best-effort; JS has no
        // guaranteed zero-fill for primitives, so we combine overwrite
        // + drop-reference.
        closureKey = '\0'.repeat(closureKey.length);
        closureKey = null;
      }
      cleared = true;
      captured = false;
    },
  });
}

export const HMAC_CLEANUP_SHUTDOWN_ID = 'hmac-cleanup.sign-and-clear';

export interface RegisterHmacShutdownOptions {
  readonly binding: HmacCleanupBinding;
  /**
   * Called during shutdown AFTER any final shutdown-signing operation the
   * caller wants to run. Use this to emit a structured-log entry or
   * similar; the binding is cleared immediately after this callback
   * returns (or resolves).
   */
  readonly onBeforeClear?: (sign: (p: string) => string) => void | Promise<void>;
}

/**
 * Register the HMAC cleanup hook on the shared shutdown registry at
 * `SHUTDOWN_ORDER.HMAC_CLEAR_AND_SIGN` (400) — after audit-sink flush
 * (300) and before process exit (999). Plan48 §2.4 integration.
 */
export function registerHmacCleanupShutdown(
  registry: ShutdownHookRegistry,
  opts: RegisterHmacShutdownOptions,
): void {
  registry.register({
    id: HMAC_CLEANUP_SHUTDOWN_ID,
    order: SHUTDOWN_ORDER.HMAC_CLEAR_AND_SIGN,
    fn: async () => {
      try {
        if (opts.onBeforeClear && opts.binding.captured) {
          await opts.onBeforeClear(opts.binding.sign.bind(opts.binding));
        }
      } finally {
        opts.binding.clear();
      }
    },
  });
}

export { HMAC_ENV_VAR_NAMES, resolveSecureStoreRoot, isPathInsideSecureStore } from './policy.js';
