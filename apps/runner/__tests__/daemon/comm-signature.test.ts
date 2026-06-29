/**
 * Tests for cross-daemon CommMessage HMAC authentication (C/T1, Addendum C-2).
 */

import { describe, it, expect } from "vitest";
import type { CommMessage } from "@openstarry/sdk";
import { signCommMessage, verifyCommMessage } from "../../src/daemon/comm-signature.js";

const KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const OTHER_KEY = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";

function msg(overrides: Partial<CommMessage> = {}): CommMessage {
  return {
    id: "m1",
    timestamp: 1000,
    source: "agent-a",
    target: "agent-b",
    payload: { hello: "world" },
    performative: "inform",
    ...overrides,
  } as CommMessage;
}

describe("comm-signature", () => {
  it("verifies a message signed with the same key", () => {
    const m = msg();
    const sig = signCommMessage(m, KEY);
    expect(verifyCommMessage(m, sig, KEY)).toBe(true);
  });

  it("rejects a signature made with a different key (forged sender)", () => {
    const m = msg();
    const sig = signCommMessage(m, OTHER_KEY);
    expect(verifyCommMessage(m, sig, KEY)).toBe(false);
  });

  it("rejects when any signed field is tampered (source spoof)", () => {
    const m = msg();
    const sig = signCommMessage(m, KEY);
    const tampered = { ...m, source: "agent-evil" };
    expect(verifyCommMessage(tampered, sig, KEY)).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const m = msg();
    const sig = signCommMessage(m, KEY);
    const tampered = { ...m, payload: { hello: "evil" } };
    expect(verifyCommMessage(tampered, sig, KEY)).toBe(false);
  });

  it("is order-independent (canonical): key order in payload does not change the sig", () => {
    const a = msg({ payload: { x: 1, y: 2 } });
    const b = msg({ payload: { y: 2, x: 1 } });
    expect(signCommMessage(a, KEY)).toBe(signCommMessage(b, KEY));
  });

  it("rejects empty / malformed signatures (fail-closed, no throw)", () => {
    const m = msg();
    expect(verifyCommMessage(m, "", KEY)).toBe(false);
    expect(verifyCommMessage(m, "not-hex-zz", KEY)).toBe(false);
  });
});
