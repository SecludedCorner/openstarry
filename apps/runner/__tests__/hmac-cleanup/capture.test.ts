/**
 * C48-M3a / M3b / M3d unit tests.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  captureHmacKey,
  HMAC_ENV_VAR_NAMES,
  isPathInsideSecureStore,
  resolveSecureStoreRoot,
  registerHmacCleanupShutdown,
} from '../../src/hmac-cleanup/index.js';
import { createShutdownHookRegistry } from '../../src/audit-infra/shutdown-hooks.js';
import { createHmac } from 'node:crypto';

const TEST_KEY = 'a'.repeat(64); // 64 chars; passes 32-byte minimum.

beforeEach(() => {
  for (const n of HMAC_ENV_VAR_NAMES) delete process.env[n];
  delete process.env['OPENSTARRY_SECURE_STORE'];
  delete process.env['OPENSTARRY_DATA_DIR'];
});

afterEach(() => {
  for (const n of HMAC_ENV_VAR_NAMES) delete process.env[n];
  delete process.env['OPENSTARRY_SECURE_STORE'];
  delete process.env['OPENSTARRY_DATA_DIR'];
});

describe('captureHmacKey (C48-M3a)', () => {
  it('returns null when no env var set', () => {
    expect(captureHmacKey()).toBeNull();
  });

  it('captures key and zeroes env var immediately', () => {
    process.env['OPENSTARRY_CHECKPOINT_HMAC_KEY'] = TEST_KEY;
    const binding = captureHmacKey();
    expect(binding).not.toBeNull();
    expect(binding!.captured).toBe(true);
    expect(process.env['OPENSTARRY_CHECKPOINT_HMAC_KEY']).toBeUndefined();
  });

  it('prefers primary env var over fallback', () => {
    process.env['OPENSTARRY_CHECKPOINT_HMAC_KEY'] = TEST_KEY;
    process.env['HMAC_KEY'] = 'b'.repeat(64);
    const binding = captureHmacKey();
    const fromBinding = binding!.sign('payload');
    const expected = createHmac('sha256', TEST_KEY).update('payload').digest('hex');
    expect(fromBinding).toBe(expected);
  });

  it('accepts directKey injection (bypasses env)', () => {
    const binding = captureHmacKey({ directKey: TEST_KEY });
    expect(binding).not.toBeNull();
    const sig = binding!.sign('hi');
    expect(sig).toBe(createHmac('sha256', TEST_KEY).update('hi').digest('hex'));
  });

  it('sign() throws after clear()', () => {
    const binding = captureHmacKey({ directKey: TEST_KEY });
    expect(binding).not.toBeNull();
    binding!.clear();
    expect(binding!.cleared).toBe(true);
    expect(() => binding!.sign('x')).toThrow(/already cleared/);
  });

  it('clear() is idempotent', () => {
    const binding = captureHmacKey({ directKey: TEST_KEY });
    binding!.clear();
    binding!.clear();
    expect(binding!.cleared).toBe(true);
  });
});

describe('policy (C48-M3b)', () => {
  it('secure-store root defaults under data dir', () => {
    process.env['OPENSTARRY_DATA_DIR'] = '/tmp/test-data';
    const root = resolveSecureStoreRoot();
    expect(root.replace(/\\/g, '/')).toBe('/tmp/test-data/.secrets');
  });

  it('OPENSTARRY_SECURE_STORE overrides', () => {
    process.env['OPENSTARRY_SECURE_STORE'] = '/vault';
    expect(resolveSecureStoreRoot()).toBe('/vault');
  });

  it('isPathInsideSecureStore flags paths correctly', () => {
    process.env['OPENSTARRY_SECURE_STORE'] = '/vault';
    expect(isPathInsideSecureStore('/vault/key.bin')).toBe(true);
    expect(isPathInsideSecureStore('/vault')).toBe(true);
    expect(isPathInsideSecureStore('/elsewhere/key.bin')).toBe(false);
    expect(isPathInsideSecureStore('/vaulted')).toBe(false); // not a subpath
  });
});

describe('registerHmacCleanupShutdown (C48-M3d)', () => {
  it('runs onBeforeClear with working sign, then clears binding', async () => {
    const binding = captureHmacKey({ directKey: TEST_KEY });
    expect(binding).not.toBeNull();
    const registry = createShutdownHookRegistry();
    let signResult: string | null = null;
    registerHmacCleanupShutdown(registry, {
      binding: binding!,
      onBeforeClear: (sign) => { signResult = sign('shutdown'); },
    });
    await registry.trigger('SIGTERM');
    expect(signResult).toBe(
      createHmac('sha256', TEST_KEY).update('shutdown').digest('hex'),
    );
    expect(binding!.cleared).toBe(true);
  });

  it('clears binding even when onBeforeClear throws (finally block)', async () => {
    const binding = captureHmacKey({ directKey: TEST_KEY });
    const registry = createShutdownHookRegistry();
    registerHmacCleanupShutdown(registry, {
      binding: binding!,
      onBeforeClear: () => { throw new Error('boom'); },
    });
    await registry.trigger('programmatic');
    expect(binding!.cleared).toBe(true);
  });

  it('no-op path: binding already cleared skips onBeforeClear', async () => {
    const binding = captureHmacKey({ directKey: TEST_KEY });
    binding!.clear();
    const registry = createShutdownHookRegistry();
    let called = false;
    registerHmacCleanupShutdown(registry, {
      binding: binding!,
      onBeforeClear: () => { called = true; },
    });
    await registry.trigger('SIGTERM');
    expect(called).toBe(false);
  });
});
