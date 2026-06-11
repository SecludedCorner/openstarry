import { describe, it, expect, beforeEach } from "vitest";
import { MessageRouter } from "../../src/daemon/message-router.js";
import type { AgentCommCapabilities } from "../../src/daemon/message-router.js";
import { MAX_TRACE_DEPTH } from "@openstarry/sdk";
import type { CommMessage } from "@openstarry/sdk";

function makeMessage(source: string, target: string | undefined, traceDepth?: number): CommMessage {
  return {
    id: `msg-${source}-${target ?? "broadcast"}`,
    source,
    target,
    performative: "inform",
    payload: {},
    timestamp: Date.now(),
    ...(traceDepth !== undefined ? { traceDepth } : {}),
  };
}

describe("C11 — MessageRouter (Plan37, D2-R5)", () => {
  let router: MessageRouter;

  const agentACaps: AgentCommCapabilities = {
    canSendTo: ["agent-b"],
    canReceiveFrom: ["agent-b"],
    exposedTools: ["tool-x"],
  };
  const agentBCaps: AgentCommCapabilities = {
    canSendTo: ["agent-a"],
    canReceiveFrom: ["agent-a"],
    exposedTools: ["tool-y"],
  };

  beforeEach(() => {
    router = new MessageRouter();
  });

  describe("validateMessage", () => {
    it("allows when sender canSendTo and receiver canReceiveFrom are satisfied", () => {
      router.registerAgent("agent-a", agentACaps);
      router.registerAgent("agent-b", agentBCaps);
      const result = router.validateMessage(makeMessage("agent-a", "agent-b"));
      expect(result.allowed).toBe(true);
    });

    it("rejects when sender lacks canSendTo permission", () => {
      router.registerAgent("agent-a", { canSendTo: [], canReceiveFrom: ["agent-b"], exposedTools: [] });
      router.registerAgent("agent-b", agentBCaps);
      const result = router.validateMessage(makeMessage("agent-a", "agent-b"));
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/not allowed to send to/);
    });

    it("rejects when receiver lacks canReceiveFrom permission", () => {
      router.registerAgent("agent-a", agentACaps);
      router.registerAgent("agent-b", { canSendTo: ["agent-a"], canReceiveFrom: [], exposedTools: [] });
      const result = router.validateMessage(makeMessage("agent-a", "agent-b"));
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/does not accept from/);
    });

    it("rejects when sender is not registered (fail-closed)", () => {
      router.registerAgent("agent-b", agentBCaps);
      const result = router.validateMessage(makeMessage("agent-unknown", "agent-b"));
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/not registered/);
    });

    it("allows broadcast messages (no target) from registered sender", () => {
      router.registerAgent("agent-a", agentACaps);
      const result = router.validateMessage(makeMessage("agent-a", undefined));
      expect(result.allowed).toBe(true);
    });

    it("SEC-004: rejects broadcast from unregistered sender (fail-closed)", () => {
      // Sender not registered — broadcast must be denied.
      const result = router.validateMessage(makeMessage("agent-unknown", undefined));
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/not registered/);
    });

    it("wildcard '*' in canSendTo allows any target", () => {
      router.registerAgent("agent-a", { canSendTo: ["*"], canReceiveFrom: [], exposedTools: [] });
      router.registerAgent("agent-b", { canSendTo: [], canReceiveFrom: ["*"], exposedTools: [] });
      const result = router.validateMessage(makeMessage("agent-a", "agent-b"));
      expect(result.allowed).toBe(true);
    });

    it("wildcard '*' in canReceiveFrom allows any sender", () => {
      router.registerAgent("agent-a", { canSendTo: ["agent-b"], canReceiveFrom: [], exposedTools: [] });
      router.registerAgent("agent-b", { canSendTo: [], canReceiveFrom: ["*"], exposedTools: [] });
      const result = router.validateMessage(makeMessage("agent-a", "agent-b"));
      expect(result.allowed).toBe(true);
    });

    describe("FINDING-3 — MAX_TRACE_DEPTH enforcement", () => {
      beforeEach(() => {
        router.registerAgent("agent-a", agentACaps);
        router.registerAgent("agent-b", agentBCaps);
      });

      it(`allows message with traceDepth = MAX_TRACE_DEPTH (${MAX_TRACE_DEPTH})`, () => {
        const result = router.validateMessage(makeMessage("agent-a", "agent-b", MAX_TRACE_DEPTH));
        expect(result.allowed).toBe(true);
      });

      it(`rejects message with traceDepth = MAX_TRACE_DEPTH + 1 (${MAX_TRACE_DEPTH + 1})`, () => {
        const result = router.validateMessage(makeMessage("agent-a", "agent-b", MAX_TRACE_DEPTH + 1));
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/traceDepth.*exceeds MAX_TRACE_DEPTH/);
      });

      it("allows message without traceDepth field", () => {
        const result = router.validateMessage(makeMessage("agent-a", "agent-b"));
        expect(result.allowed).toBe(true);
      });
    });
  });

  describe("validateChildCapabilities", () => {
    const parentCaps: AgentCommCapabilities = {
      canSendTo: ["agent-b", "agent-c"],
      canReceiveFrom: ["agent-b"],
      exposedTools: ["tool-x", "tool-y"],
    };

    it("passes when child capabilities are a subset of parent", () => {
      const childCaps: AgentCommCapabilities = {
        canSendTo: ["agent-b"],
        canReceiveFrom: ["agent-b"],
        exposedTools: ["tool-x"],
      };
      const result = router.validateChildCapabilities(parentCaps, childCaps);
      expect(result.allowed).toBe(true);
    });

    it("passes when child has zero capabilities", () => {
      const childCaps: AgentCommCapabilities = {
        canSendTo: [],
        canReceiveFrom: [],
        exposedTools: [],
      };
      const result = router.validateChildCapabilities(parentCaps, childCaps);
      expect(result.allowed).toBe(true);
    });

    it("rejects when child canSendTo exceeds parent", () => {
      const childCaps: AgentCommCapabilities = {
        canSendTo: ["agent-d"],
        canReceiveFrom: [],
        exposedTools: [],
      };
      const result = router.validateChildCapabilities(parentCaps, childCaps);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/canSendTo.*not in parent/);
    });

    it("rejects when child canReceiveFrom exceeds parent", () => {
      const childCaps: AgentCommCapabilities = {
        canSendTo: [],
        canReceiveFrom: ["agent-z"],
        exposedTools: [],
      };
      const result = router.validateChildCapabilities(parentCaps, childCaps);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/canReceiveFrom.*not in parent/);
    });

    it("rejects when child exposedTools exceeds parent", () => {
      const childCaps: AgentCommCapabilities = {
        canSendTo: [],
        canReceiveFrom: [],
        exposedTools: ["tool-secret"],
      };
      const result = router.validateChildCapabilities(parentCaps, childCaps);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/exposedTools.*not in parent/);
    });
  });

  describe("registerAgent / deregisterAgent", () => {
    it("deregistered agent cannot send (fail-closed)", () => {
      router.registerAgent("agent-a", agentACaps);
      router.registerAgent("agent-b", agentBCaps);
      router.deregisterAgent("agent-a");
      const result = router.validateMessage(makeMessage("agent-a", "agent-b"));
      expect(result.allowed).toBe(false);
    });
  });
});
