/**
 * hmac-cleanup/policy — C48-M3b ephemeral key-source enforcement.
 *
 * Plan48 §2.3 threat model (within-process scope per D-12b): HMAC signing in
 * OpenStarry operates with within-process scope; the adversary threat model
 * assumes absence of in-process memory read. Out-of-process / cross-process
 * HMAC authentication is NOT in scope for Plan48 or its predecessors.
 *
 * Ephemeral enforcement: no disk persistence except the pre-agreed secure
 * store (typically `<data_dir>/.secrets/` if configured). This module
 * provides the helpers; actual disk I/O sits in the caller.
 *
 * @since Plan48 C48-M3b
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { envString } from '../audit-infra/env-parse.js';

export const DEFAULT_SECURE_STORE_REL = '.secrets';

export function resolveSecureStoreRoot(): string {
  const explicit = envString('OPENSTARRY_SECURE_STORE', '');
  if (explicit !== '') return explicit;
  const data = envString('OPENSTARRY_DATA_DIR', join(homedir(), '.openstarry'));
  return join(data, DEFAULT_SECURE_STORE_REL);
}

/**
 * True when the given absolute path is inside the configured secure-store
 * root; false otherwise. Used by disk-scan tests (C48-M3b) to verify no
 * key material escapes the allowed path.
 */
export function isPathInsideSecureStore(absPath: string): boolean {
  const root = resolveSecureStoreRoot();
  const normRoot = root.replace(/\\/g, '/');
  const normPath = absPath.replace(/\\/g, '/');
  return normPath === normRoot || normPath.startsWith(`${normRoot}/`);
}

/** HMAC env-var names that must be zeroed after capture. */
export const HMAC_ENV_VAR_NAMES = [
  'OPENSTARRY_CHECKPOINT_HMAC_KEY',
  'HMAC_KEY',
] as const;
