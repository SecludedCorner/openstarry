/**
 * Plan47 C47-K3-M3 — snapshot-store file backend tests.
 *
 * Covers:
 *   - write → read round-trip preserves Map<string, PluginSnapshot>
 *   - tampered payload fails verification (fail-closed)
 *   - wrong key fails verification
 *   - replay detection via NonceRegistry
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginSnapshot } from '@openstarry/sdk';
import { readSnapshotStore, writeSnapshotStore } from '../../src/utils/snapshot-store.js';
import { NonceRegistry, SNAPSHOT_MIN_KEY_LENGTH_BYTES } from '../../src/utils/snapshot-hmac.js';

const KEY = 'a'.repeat(SNAPSHOT_MIN_KEY_LENGTH_BYTES * 2);
const OTHER_KEY = 'b'.repeat(SNAPSHOT_MIN_KEY_LENGTH_BYTES * 2);

function fixtureSnapshot(name: string, value: number): PluginSnapshot {
  return {
    pluginName: name,
    schemaVersion: 1,
    state: { value },
    timestamp: 1000 + value,
  };
}

describe('snapshot-store file backend', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'plan47-snap-'));
    path = join(dir, 'checkpoint.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trip preserves snapshots across write → read', async () => {
    const snaps = new Map<string, PluginSnapshot>([
      ['p1', fixtureSnapshot('p1', 7)],
      ['p2', fixtureSnapshot('p2', 42)],
    ]);
    await writeSnapshotStore(snaps, { path, key: KEY });
    const res = await readSnapshotStore({ path, key: KEY });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.snapshots.size).toBe(2);
    expect(res.snapshots.get('p1')?.state['value']).toBe(7);
    expect(res.snapshots.get('p2')?.state['value']).toBe(42);
  });

  it('tampered payload fails verification with structured reason', async () => {
    const snaps = new Map<string, PluginSnapshot>([['p1', fixtureSnapshot('p1', 1)]]);
    await writeSnapshotStore(snaps, { path, key: KEY });
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    raw['payload'] = (raw['payload'] as string).replace('"value":1', '"value":999');
    writeFileSync(path, JSON.stringify(raw), 'utf-8');

    const res = await readSnapshotStore({ path, key: KEY });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/HMAC verify failed/);
  });

  it('wrong key fails verification', async () => {
    const snaps = new Map<string, PluginSnapshot>([['p1', fixtureSnapshot('p1', 1)]]);
    await writeSnapshotStore(snaps, { path, key: KEY });
    const res = await readSnapshotStore({ path, key: OTHER_KEY });
    expect(res.ok).toBe(false);
  });

  it('missing file returns structured not-found (first-run happy path)', async () => {
    const res = await readSnapshotStore({ path, key: KEY });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/not found/);
  });

  it('replay detection via NonceRegistry', async () => {
    const snaps = new Map<string, PluginSnapshot>([['p1', fixtureSnapshot('p1', 1)]]);
    await writeSnapshotStore(snaps, { path, key: KEY });
    const reg = new NonceRegistry();
    const first = await readSnapshotStore({ path, key: KEY, nonces: reg });
    expect(first.ok).toBe(true);
    // Second read of the same file = same nonce = replay.
    const second = await readSnapshotStore({ path, key: KEY, nonces: reg });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toMatch(/replay/);
  });
});
