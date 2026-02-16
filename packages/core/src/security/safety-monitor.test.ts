import { describe, it, expect } from "vitest";
import { createSafetyMonitor } from "./safety-monitor.js";

describe("SafetyMonitor", () => {
  describe("Loop tick limit (resource level)", () => {
    it("allows ticks within the limit", () => {
      const monitor = createSafetyMonitor({ maxLoopTicks: 3 });
      monitor.onLoopStart();

      expect(monitor.onLoopTick().halt).toBe(false);
      expect(monitor.onLoopTick().halt).toBe(false);
      expect(monitor.onLoopTick().halt).toBe(false);
    });

    it("halts when tick limit is exceeded", () => {
      const monitor = createSafetyMonitor({ maxLoopTicks: 2 });
      monitor.onLoopStart();

      monitor.onLoopTick(); // 1
      monitor.onLoopTick(); // 2
      const result = monitor.onLoopTick(); // 3 — exceeds

      expect(result.halt).toBe(true);
      expect(result.reason).toContain("Loop tick limit exceeded");
    });

    it("onLoopStart() resets tick counter", () => {
      const monitor = createSafetyMonitor({ maxLoopTicks: 2 });
      monitor.onLoopStart();

      monitor.onLoopTick();
      monitor.onLoopTick();

      // New loop start
      monitor.onLoopStart();
      expect(monitor.onLoopTick().halt).toBe(false);
    });
  });

  describe("Token budget (resource level)", () => {
    it("allows LLM calls within budget", () => {
      const monitor = createSafetyMonitor({ maxTokenUsage: 1000 });

      monitor.trackTokenUsage(500);
      expect(monitor.beforeLLMCall().halt).toBe(false);
    });

    it("halts when token budget is exhausted", () => {
      const monitor = createSafetyMonitor({ maxTokenUsage: 1000 });

      monitor.trackTokenUsage(1000);
      const result = monitor.beforeLLMCall();

      expect(result.halt).toBe(true);
      expect(result.reason).toContain("Token budget exhausted");
    });

    it("unlimited when maxTokenUsage is 0", () => {
      const monitor = createSafetyMonitor({ maxTokenUsage: 0 });

      monitor.trackTokenUsage(999999);
      expect(monitor.beforeLLMCall().halt).toBe(false);
    });
  });

  describe("Repetitive tool call detection (behavioral level)", () => {
    it("injects prompt after N identical failed tool calls", () => {
      const monitor = createSafetyMonitor({ repetitiveFailThreshold: 3 });

      const args = JSON.stringify({ path: "/foo" });
      monitor.afterToolExecution("fs.read", args, true); // 1
      monitor.afterToolExecution("fs.read", args, true); // 2
      const result = monitor.afterToolExecution("fs.read", args, true); // 3

      expect(result.halt).toBe(false);
      expect(result.injectPrompt).toContain("STOP and analyze");
    });

    it("does not trigger for different tool calls", () => {
      const monitor = createSafetyMonitor({ repetitiveFailThreshold: 3 });

      monitor.afterToolExecution("fs.read", '{"a":1}', true);
      monitor.afterToolExecution("fs.write", '{"b":2}', true);
      const result = monitor.afterToolExecution("fs.list", '{"c":3}', true);

      expect(result.injectPrompt).toBeUndefined();
    });

    it("resets on successful tool call", () => {
      const monitor = createSafetyMonitor({ repetitiveFailThreshold: 3 });

      const args = JSON.stringify({ path: "/foo" });
      monitor.afterToolExecution("fs.read", args, true);
      monitor.afterToolExecution("fs.read", args, true);
      monitor.afterToolExecution("fs.read", args, false); // success resets

      const result = monitor.afterToolExecution("fs.read", args, true);
      expect(result.injectPrompt).toBeUndefined();
    });
  });

  describe("Frustration counter (behavioral level)", () => {
    it("injects help prompt after consecutive failures", () => {
      const monitor = createSafetyMonitor({ frustrationThreshold: 3 });

      monitor.afterToolExecution("a", "{}", true);
      monitor.afterToolExecution("b", "{}", true);
      const result = monitor.afterToolExecution("c", "{}", true); // 3rd

      expect(result.halt).toBe(false);
      expect(result.injectPrompt).toContain("ask the user for help");
    });

    it("resets consecutive failures on success", () => {
      const monitor = createSafetyMonitor({ frustrationThreshold: 3 });

      monitor.afterToolExecution("a", "{}", true);
      monitor.afterToolExecution("b", "{}", true);
      monitor.afterToolExecution("c", "{}", false); // success resets

      const result = monitor.afterToolExecution("d", "{}", true);
      expect(result.injectPrompt).toBeUndefined();
    });
  });

  describe("Error cascade detection (behavioral level)", () => {
    it("halts on high error rate in sliding window", () => {
      const monitor = createSafetyMonitor({
        errorWindowSize: 5,
        errorRateThreshold: 0.8,
        frustrationThreshold: 100, // disable frustration for this test
      });

      // Fill window with errors (different args to avoid repetitive detection)
      monitor.afterToolExecution("a", '{"x":1}', true);
      monitor.afterToolExecution("b", '{"x":2}', true);
      monitor.afterToolExecution("c", '{"x":3}', true);
      monitor.afterToolExecution("d", '{"x":4}', true);
      const result = monitor.afterToolExecution("e", '{"x":5}', true); // 5/5 = 100%

      expect(result.halt).toBe(true);
      expect(result.reason).toContain("Error cascade");
    });

    it("does not halt when error rate is below threshold", () => {
      const monitor = createSafetyMonitor({
        errorWindowSize: 5,
        errorRateThreshold: 0.8,
        frustrationThreshold: 100, // disable frustration
      });

      monitor.afterToolExecution("a", '{"x":1}', true);
      monitor.afterToolExecution("b", '{"x":2}', false); // success
      monitor.afterToolExecution("c", '{"x":3}', true);
      monitor.afterToolExecution("d", '{"x":4}', true);
      const result = monitor.afterToolExecution("e", '{"x":5}', true); // 4/5 = 80% >= 80%

      // 80% exactly matches threshold — should halt
      expect(result.halt).toBe(true);
    });
  });

  describe("reset()", () => {
    it("resets all counters", () => {
      const monitor = createSafetyMonitor({
        maxLoopTicks: 2,
        maxTokenUsage: 100,
      });

      monitor.onLoopStart();
      monitor.onLoopTick();
      monitor.onLoopTick();
      monitor.trackTokenUsage(100);

      monitor.reset();

      monitor.onLoopStart();
      expect(monitor.onLoopTick().halt).toBe(false);
      expect(monitor.beforeLLMCall().halt).toBe(false);
    });
  });
});
