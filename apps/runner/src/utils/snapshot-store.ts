/**
 * snapshot-store — Plan47 K-3 wire-in file-system backend for signed PluginSnapshot bundles.
 *
 * Writes the Map<pluginName, PluginSnapshot> produced by CheckpointManager
 * to a single JSON file on disk, with an HMAC-SHA256 signature + nonce so
 * tampered or replayed blobs are rejected on restore.
 *
 * Tenets preserved:
 *   - MR-6: HMAC key is accepted from the caller (env / CLI / plugin config),
 *     never referenced by Core. File paths are supplied by the caller as well.
 *   - Tenet #2 plugin autonomy: the per-plugin PluginSnapshot payload is
 *     treated as opaque JSON — this store never introspects plugin state.
 *   - Fail-closed: any signature or nonce failure returns a structured
 *     {ok:false, reason} error; the runner falls back to fresh state (matches
 *     the CheckpointManager SDK contract).
 *
 * @see Plan47_Implementation_Plan.md §3 W1 Consumer Wire-In
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PluginSnapshot } from '@openstarry/sdk';
import {
  signSnapshotPayload,
  verifySnapshotPayload,
  NonceRegistry,
  type SnapshotSignatureEnvelope,
} from './snapshot-hmac.js';

/** Envelope version — bump on incompatible on-disk format changes. */
export const SNAPSHOT_STORE_ENVELOPE_VERSION = 1;

/** On-disk envelope layout (stable contract). */
export interface SnapshotStoreFile {
  readonly envelopeVersion: 1;
  readonly createdAt: number;
  readonly payload: string; // canonical JSON of SnapshotPayload
  readonly signature: SnapshotSignatureEnvelope;
}

/** Payload structure signed by the HMAC (decoded from envelope.payload). */
export interface SnapshotPayload {
  readonly version: 1;
  readonly snapshots: ReadonlyArray<[string, PluginSnapshot]>;
}

export interface SnapshotStoreOptions {
  /** HMAC key (hex / base64 / utf-8 string, or Buffer). Min 32 bytes. */
  readonly key: Buffer | string;
  /** Absolute path of the checkpoint file. */
  readonly path: string;
  /** Optional nonce registry for replay protection across reads. */
  readonly nonces?: NonceRegistry;
}

/**
 * Serialize the snapshot map to a signed envelope and write it atomically
 * (temp file + rename) so readers never see a partial blob.
 */
export async function writeSnapshotStore(
  snapshots: Map<string, PluginSnapshot>,
  options: SnapshotStoreOptions,
): Promise<void> {
  const payload: SnapshotPayload = {
    version: 1,
    snapshots: [...snapshots.entries()].map(([name, snap]) => [name, snap]),
  };
  const payloadJson = JSON.stringify(payload);
  const signature = signSnapshotPayload(payloadJson, options.key);
  const envelope: SnapshotStoreFile = {
    envelopeVersion: SNAPSHOT_STORE_ENVELOPE_VERSION,
    createdAt: Date.now(),
    payload: payloadJson,
    signature,
  };
  await mkdir(dirname(options.path), { recursive: true });
  const tmp = `${options.path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(envelope, null, 2), { encoding: 'utf-8', mode: 0o600 });
  const { rename } = await import('node:fs/promises');
  await rename(tmp, options.path);
}

export type ReadSnapshotResult =
  | { readonly ok: true; readonly snapshots: Map<string, PluginSnapshot>; readonly createdAt: number }
  | { readonly ok: false; readonly reason: string };

/**
 * Read + verify a snapshot file. Returns a structured error rather than
 * throwing so the runner can log and fall back to fresh state.
 */
export async function readSnapshotStore(options: SnapshotStoreOptions): Promise<ReadSnapshotResult> {
  if (!existsSync(options.path)) {
    return { ok: false, reason: `checkpoint file not found: ${options.path}` };
  }
  let raw: string;
  try {
    raw = await readFile(options.path, 'utf-8');
  } catch (err) {
    return { ok: false, reason: `read failed: ${(err as Error).message}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `JSON parse failed: ${(err as Error).message}` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'envelope must be an object' };
  }
  const env = parsed as Record<string, unknown>;
  if (env['envelopeVersion'] !== SNAPSHOT_STORE_ENVELOPE_VERSION) {
    return { ok: false, reason: `unsupported envelopeVersion ${String(env['envelopeVersion'])}` };
  }
  if (typeof env['payload'] !== 'string') {
    return { ok: false, reason: 'payload must be a string' };
  }
  if (env['signature'] === null || typeof env['signature'] !== 'object') {
    return { ok: false, reason: 'signature must be an object' };
  }
  const signature = env['signature'] as unknown as SnapshotSignatureEnvelope;
  const verify = verifySnapshotPayload(env['payload'] as string, signature, options.key);
  if (!verify.ok) {
    return { ok: false, reason: `HMAC verify failed: ${verify.reason}` };
  }
  if (options.nonces && !options.nonces.register(signature.nonce)) {
    return { ok: false, reason: 'replay detected: nonce already observed' };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(env['payload'] as string);
  } catch (err) {
    return { ok: false, reason: `payload JSON parse failed: ${(err as Error).message}` };
  }
  if (payload === null || typeof payload !== 'object') {
    return { ok: false, reason: 'payload must be an object' };
  }
  const p = payload as Record<string, unknown>;
  if (p['version'] !== 1) {
    return { ok: false, reason: `unsupported payload version ${String(p['version'])}` };
  }
  if (!Array.isArray(p['snapshots'])) {
    return { ok: false, reason: 'payload.snapshots must be an array' };
  }
  const snapshots = new Map<string, PluginSnapshot>();
  for (const entry of p['snapshots'] as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [name, snap] = entry;
    if (typeof name !== 'string' || snap === null || typeof snap !== 'object') continue;
    const s = snap as Record<string, unknown>;
    if (typeof s['pluginName'] !== 'string') continue;
    if (typeof s['schemaVersion'] !== 'number') continue;
    if (s['state'] === null || typeof s['state'] !== 'object') continue;
    if (typeof s['timestamp'] !== 'number') continue;
    snapshots.set(name, {
      pluginName: s['pluginName'] as string,
      schemaVersion: s['schemaVersion'] as number,
      state: s['state'] as Record<string, unknown>,
      timestamp: s['timestamp'] as number,
    });
  }
  return {
    ok: true,
    snapshots,
    createdAt: typeof env['createdAt'] === 'number' ? (env['createdAt'] as number) : 0,
  };
}
