import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "./index.js";

describe("Logger", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalEnv = process.env;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    process.env = originalEnv;
  });

  describe("time()", () => {
    it("returns a numeric duration >= 0", async () => {
      process.env.LOG_LEVEL = "debug";
      const logger = createLogger("test");
      const stop = logger.time("test-operation");

      await new Promise((resolve) => setTimeout(resolve, 10));
      const duration = stop();

      expect(typeof duration).toBe("number");
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it("stop function logs at debug level", () => {
      process.env.LOG_LEVEL = "debug";
      const logger = createLogger("test");
      const stop = logger.time("test-operation");

      consoleErrorSpy.mockClear();
      stop();

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const call = consoleErrorSpy.mock.calls[0][0];
      expect(call).toContain("[DEBUG]");
      expect(call).toContain("test-operation completed");
    });

    it("log includes label and durationMs in data", () => {
      process.env.LOG_LEVEL = "debug";
      process.env.LOG_FORMAT = "json";
      const logger = createLogger("test");
      const stop = logger.time("test-operation");

      consoleErrorSpy.mockClear();
      stop();

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const output = consoleErrorSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.label).toBe("test-operation");
      expect(typeof parsed.durationMs).toBe("number");
      expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("time() works in JSON format mode", () => {
      process.env.LOG_LEVEL = "debug";
      process.env.LOG_FORMAT = "json";
      const logger = createLogger("test");
      const stop = logger.time("json-test");

      consoleErrorSpy.mockClear();
      const duration = stop();

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const output = consoleErrorSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.level).toBe("debug");
      expect(parsed.message).toContain("json-test completed");
      expect(parsed.label).toBe("json-test");
      expect(parsed.durationMs).toBe(duration);
    });

    it("child logger has time() method", () => {
      const logger = createLogger("parent");
      const child = logger.child("child");

      expect(child.time).toBeDefined();
      expect(typeof child.time).toBe("function");
    });
  });

  describe("sessionId context", () => {
    it("sessionId in LogContext is preserved via setContext", () => {
      process.env.LOG_LEVEL = "debug";
      process.env.LOG_FORMAT = "json";
      const logger = createLogger("test");

      logger.setContext({ sessionId: "sess-123" });
      consoleErrorSpy.mockClear();
      logger.debug("test message");

      const output = consoleErrorSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.session_id).toBe("sess-123");
    });

    it("sessionId appears in JSON output", () => {
      process.env.LOG_FORMAT = "json";
      const logger = createLogger("test");

      logger.setContext({ sessionId: "sess-456", agentId: "agent-1" });
      consoleErrorSpy.mockClear();
      logger.info("test with session");

      const output = consoleErrorSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.session_id).toBe("sess-456");
      expect(parsed.agent_id).toBe("agent-1");
      expect(parsed.message).toBe("test with session");
    });

    it("sessionId propagates to child logger", () => {
      process.env.LOG_FORMAT = "json";
      const logger = createLogger("parent");

      logger.setContext({ sessionId: "sess-789", traceId: "trace-1" });
      const child = logger.child("child");

      consoleErrorSpy.mockClear();
      child.info("child message");

      const output = consoleErrorSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.session_id).toBe("sess-789");
      expect(parsed.trace_id).toBe("trace-1");
      expect(parsed.module).toBe("parent:child");
    });
  });
});
