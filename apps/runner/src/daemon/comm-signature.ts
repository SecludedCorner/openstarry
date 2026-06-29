/**
 * comm-signature — HMAC-SHA256 authentication for cross-daemon CommMessages.
 *
 * Fractal Society C/T1 (Spec Addendum C-2, Master-ratified 2026-06-26): a
 * CommMessage delivered from one daemon to another is signed with the cluster
 * HMAC key (the same daemon-distributed key used for alaya seed signatures),
 * so the receiver can verify the sender's identity is not forged — `source` is
 * the basis for the MessageRouter capability check, so it MUST be unforgeable.
 *
 * The signature travels in the `comm.deliver` RPC envelope, NOT inside the
 * frozen CommMessage type (no SDK type change). It covers the full message via
 * a deterministic canonical serialization (recursively sorted keys).
 *
 * Honest scope (inherited from the alaya transport precedent it generalizes):
 * same-host, trusted-parent key distribution. Not a defense against a peer that
 * legitimately holds the cluster key.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { CommMessage } from "@openstarry/sdk";

/** Recursively key-sorted JSON for a stable, order-independent digest input. */
function canonical(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonical((value as Record<string, unknown>)[key]);
  }
  return out;
}

/**
 * HMAC-SHA256 (hex) over the canonical serialization of any JSON value. The
 * generic core shared by CommMessage signing (C/T1) and coordination-event
 * signing (C/T2) — both cross-daemon envelopes authenticated with the cluster key.
 */
export function signCanonical(value: unknown, keyHex: string): string {
  const payload = JSON.stringify(canonical(value));
  return createHmac("sha256", Buffer.from(keyHex, "hex")).update(payload).digest("hex");
}

/**
 * Constant-time verification that `signature` is a valid HMAC of `value` under
 * `keyHex`. Returns false on any mismatch / malformed signature (never throws) —
 * fail-closed at the call site.
 */
export function verifyCanonical(value: unknown, signature: string, keyHex: string): boolean {
  if (typeof signature !== "string" || signature.length === 0) return false;
  const expected = signCanonical(value, keyHex);
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

/** HMAC-SHA256 (hex) over the canonical serialization of a CommMessage. */
export function signCommMessage(message: CommMessage, keyHex: string): string {
  return signCanonical(message, keyHex);
}

/**
 * Constant-time verification that `signature` is a valid HMAC of `message`
 * under `keyHex`. Returns false on any mismatch / malformed signature (never
 * throws) — fail-closed at the call site.
 */
export function verifyCommMessage(message: CommMessage, signature: string, keyHex: string): boolean {
  return verifyCanonical(message, signature, keyHex);
}
