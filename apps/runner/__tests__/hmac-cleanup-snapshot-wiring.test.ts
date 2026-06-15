/**
 * A⑥ (2026-06-15): prove the hmac-cleanup capture-and-zero binding drives
 * checkpoint signing/verification — closing the gap where hmac-cleanup was a
 * library with zero production callers.
 *
 * Key properties:
 *  1. The signer abstraction is byte-identical to the legacy raw-key path
 *     (existing checkpoints stay verifiable; same HMAC scheme).
 *  2. The binding's digest (with normalizeHmacKey) === keySigner(rawKey) — so a
 *     blob signed via the binding verifies under the key, and vice versa.
 *  3. captureHmacKey reads + ZEROES the env var (capture-and-zero).
 *  4. clear() (shutdown) makes the binding refuse to sign (fail-closed).
 *  5. snapshot-store round-trips through a signer (no raw key held by the store).
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginSnapshot } from "@openstarry/sdk";
import {
  signSnapshotPayload,
  signSnapshotPayloadWith,
  verifySnapshotPayload,
  verifySnapshotPayloadWith,
  keySigner,
  normalizeHmacKey,
} from "../src/utils/snapshot-hmac.js";
import { writeSnapshotStore, readSnapshotStore } from "../src/utils/snapshot-store.js";
import { captureHmacKey } from "../src/hmac-cleanup/index.js";

const KEY_HEX = "a".repeat(64); // 32 bytes hex
const NONCE = Buffer.alloc(16, 7);
const SIGNED_AT = 1_700_000_000_000;

describe("A⑥ hmac-cleanup → checkpoint signer wiring", () => {
  it("signer path is byte-identical to the legacy raw-key path", () => {
    const legacy = signSnapshotPayload("payload-x", KEY_HEX, { nonce: NONCE, signedAt: SIGNED_AT });
    const viaSigner = signSnapshotPayloadWith("payload-x", keySigner(KEY_HEX), { nonce: NONCE, signedAt: SIGNED_AT });
    expect(viaSigner.signature).toBe(legacy.signature);
    expect(viaSigner.nonce).toBe(legacy.nonce);
  });

  it("binding.digest (with normalizeHmacKey) matches keySigner(rawKey) exactly", () => {
    const binding = captureHmacKey({ directKey: KEY_HEX, normalize: normalizeHmacKey });
    expect(binding).not.toBeNull();
    const material = Buffer.from("some-material-bytes");
    const viaBinding = binding!.digest(material);
    const viaKey = keySigner(KEY_HEX)(material);
    expect(viaBinding.equals(viaKey)).toBe(true);
  });

  it("a blob signed via the binding verifies under the raw key (and vice versa)", () => {
    const binding = captureHmacKey({ directKey: KEY_HEX, normalize: normalizeHmacKey });
    const signer = (m: Buffer) => binding!.digest(m);
    const env = signSnapshotPayloadWith("cross-check", signer, { nonce: NONCE, signedAt: SIGNED_AT });
    // verify with raw key
    expect(verifySnapshotPayload("cross-check", env, KEY_HEX).ok).toBe(true);
    // verify with the binding signer
    expect(verifySnapshotPayloadWith("cross-check", env, signer).ok).toBe(true);
    // tamper detection
    expect(verifySnapshotPayload("cross-check-TAMPERED", env, KEY_HEX).ok).toBe(false);
  });

  it("captureHmacKey reads AND zeroes the env var (capture-and-zero)", () => {
    const ENV = "OPENSTARRY_TEST_CHECKPOINT_KEY";
    process.env[ENV] = KEY_HEX;
    const binding = captureHmacKey({ envNames: [ENV], normalize: normalizeHmacKey });
    expect(binding).not.toBeNull();
    // env var must no longer expose the plaintext
    expect(process.env[ENV]).toBeUndefined();
    // but the binding can still sign
    expect(() => binding!.digest(Buffer.from("x"))).not.toThrow();
    binding!.clear();
    delete process.env[ENV];
  });

  it("clear() (shutdown) makes the binding refuse to sign — fail-closed", () => {
    const binding = captureHmacKey({ directKey: KEY_HEX, normalize: normalizeHmacKey });
    binding!.clear();
    expect(binding!.cleared).toBe(true);
    expect(() => binding!.digest(Buffer.from("x"))).toThrow(/already cleared/);
  });

  it("snapshot-store round-trips through a signer (no raw key held by the store)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-a6-"));
    const path = join(dir, "ckpt.json");
    try {
      const binding = captureHmacKey({ directKey: KEY_HEX, normalize: normalizeHmacKey });
      const signer = (m: Buffer) => binding!.digest(m);
      const snap: PluginSnapshot = { pluginName: "p1", schemaVersion: 1, state: { n: 1 }, timestamp: 123 };
      const map = new Map<string, PluginSnapshot>([["p1", snap]]);

      await writeSnapshotStore(map, { path, signer });
      const read = await readSnapshotStore({ path, signer });
      expect(read.ok).toBe(true);
      if (read.ok) {
        expect(read.snapshots.get("p1")?.state).toEqual({ n: 1 });
      }
      // a wrong key must fail verification
      const wrong = await readSnapshotStore({ path, key: "b".repeat(64) });
      expect(wrong.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
