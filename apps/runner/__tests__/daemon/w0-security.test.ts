/**
 * W0 Security Prerequisites Tests — Plan38 C1/C2/C3.
 *
 * C1: SEC-002 identity verification (pid-identity utility).
 * C2: SEC-003 path traversal prevention (isPathSafe + realpathSync in handleSpawnChild).
 * C3: SEC-005 traceDepth validation (MessageRouter).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MessageRouter } from "../../src/daemon/message-router.js";
import type { AgentCommCapabilities } from "../../src/daemon/message-router.js";
import { verifyAgentIdentity, removePidIdentity } from "../../src/daemon/pid-identity.js";
import type { CommMessage } from "@openstarry/sdk";

function makeMessage(
  source: string,
  target: string,
  traceDepth?: number,
): CommMessage {
  return {
    id: `msg-${Date.now()}`,
    source,
    target,
    performative: "inform",
    payload: {},
    timestamp: Date.now(),
    ...(traceDepth !== undefined ? { traceDepth } : {}),
  };
}

// ---------------------------------------------------------------------------
// C1: SEC-002 — PID-to-agentId identity verification
// ---------------------------------------------------------------------------
describe("W0 — SEC-002 identity verification (Plan38 C1)", () => {
  it("verifies matching PID-to-agentId (returns true)", () => {
    const map = new Map<number, string>([[1234, "agent-a"]]);
    expect(verifyAgentIdentity(1234, "agent-a", map)).toBe(true);
  });

  it("rejects unknown PID (fail-closed)", () => {
    const map = new Map<number, string>();
    expect(verifyAgentIdentity(9999, "agent-a", map)).toBe(false);
  });

  it("rejects PID mapped to different agentId (impersonation attempt)", () => {
    const map = new Map<number, string>([[1234, "agent-a"]]);
    expect(verifyAgentIdentity(1234, "agent-b", map)).toBe(false);
  });

  it("removePidIdentity cleans up entry on termination (no memory leak)", () => {
    const map = new Map<number, string>([[1234, "agent-a"]]);
    removePidIdentity(1234, map);
    expect(map.has(1234)).toBe(false);
  });

  it("removePidIdentity is safe for unknown PIDs", () => {
    const map = new Map<number, string>();
    expect(() => removePidIdentity(9999, map)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// C3: SEC-005 — traceDepth enforcement (MessageRouter)
// ---------------------------------------------------------------------------
describe("W0 — SEC-005 traceDepth enforcement (Plan38 C3)", () => {
  let router: MessageRouter;

  const caps: AgentCommCapabilities = {
    canSendTo: ["*"],
    canReceiveFrom: ["*"],
    exposedTools: [],
  };

  beforeEach(() => {
    router = new MessageRouter();
    router.registerAgent("sender", caps);
    router.registerAgent("receiver", caps);
  });

  it("rejects negative traceDepth (fail-closed)", () => {
    const result = router.validateMessage(makeMessage("sender", "receiver", -1));
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/non-negative integer/);
  });

  it("rejects floating-point traceDepth", () => {
    const result = router.validateMessage(makeMessage("sender", "receiver", 2.5));
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/non-negative integer/);
  });

  it("rejects NaN traceDepth", () => {
    const result = router.validateMessage(makeMessage("sender", "receiver", NaN));
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/non-negative integer/);
  });

  it("allows undefined traceDepth (first hop)", () => {
    const result = router.validateMessage(makeMessage("sender", "receiver"));
    expect(result.allowed).toBe(true);
  });

  it("allows traceDepth = 0 (valid non-negative integer)", () => {
    const result = router.validateMessage(makeMessage("sender", "receiver", 0));
    expect(result.allowed).toBe(true);
  });
});
