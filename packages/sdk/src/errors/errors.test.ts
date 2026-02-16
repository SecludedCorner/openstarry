import { describe, it, expect } from "vitest";
import {
  AgentError,
  TransportError,
  SessionError,
  ConfigError,
  ToolExecutionError,
  PluginLoadError,
} from "./base.js";
import { ErrorCode } from "./codes.js";

describe("Error System", () => {
  describe("AgentError", () => {
    it("should preserve cause when provided", () => {
      const rootCause = new Error("root cause");
      const err = new AgentError("test error", "TEST_CODE", { cause: rootCause });
      expect(err.cause).toBe(rootCause);
      expect(err.code).toBe("TEST_CODE");
      expect(err.message).toBe("test error");
    });

    it("should work without cause (backward compat)", () => {
      const err = new AgentError("test error", "TEST_CODE");
      expect(err.cause).toBeUndefined();
      expect(err.code).toBe("TEST_CODE");
      expect(err.message).toBe("test error");
    });
  });

  describe("TransportError", () => {
    it("should have correct name, code, and transport property", () => {
      const err = new TransportError("websocket", "connection failed");
      expect(err.name).toBe("TransportError");
      expect(err.code).toBe("TRANSPORT_ERROR");
      expect(err.transport).toBe("websocket");
      expect(err.message).toBe('Transport "websocket" error: connection failed');
    });

    it("should accept custom code", () => {
      const err = new TransportError("http", "send failed", { code: "TRANSPORT_SEND_ERROR" });
      expect(err.code).toBe("TRANSPORT_SEND_ERROR");
      expect(err.transport).toBe("http");
    });

    it("should preserve cause", () => {
      const rootCause = new Error("socket closed");
      const err = new TransportError("websocket", "connection lost", { cause: rootCause });
      expect(err.cause).toBe(rootCause);
    });

    it("should be instanceof AgentError", () => {
      const err = new TransportError("http", "test");
      expect(err).toBeInstanceOf(AgentError);
    });
  });

  describe("SessionError", () => {
    it("should have correct name, code, and sessionId property", () => {
      const err = new SessionError("session-123", "session not found");
      expect(err.name).toBe("SessionError");
      expect(err.code).toBe("SESSION_ERROR");
      expect(err.sessionId).toBe("session-123");
      expect(err.message).toBe('Session "session-123" error: session not found');
    });

    it("should accept custom code", () => {
      const err = new SessionError("session-456", "not found", { code: "SESSION_NOT_FOUND" });
      expect(err.code).toBe("SESSION_NOT_FOUND");
      expect(err.sessionId).toBe("session-456");
    });

    it("should be instanceof AgentError", () => {
      const err = new SessionError("session-789", "test");
      expect(err).toBeInstanceOf(AgentError);
    });
  });

  describe("ConfigError", () => {
    it("should have correct name and code", () => {
      const err = new ConfigError("invalid configuration");
      expect(err.name).toBe("ConfigError");
      expect(err.code).toBe("CONFIG_ERROR");
      expect(err.message).toBe("invalid configuration");
    });

    it("should accept custom code", () => {
      const err = new ConfigError("validation failed", { code: "CONFIG_VALIDATION_ERROR" });
      expect(err.code).toBe("CONFIG_VALIDATION_ERROR");
    });

    it("should preserve cause", () => {
      const rootCause = new Error("parse error");
      const err = new ConfigError("config load failed", { cause: rootCause });
      expect(err.cause).toBe(rootCause);
    });

    it("should be instanceof AgentError", () => {
      const err = new ConfigError("test");
      expect(err).toBeInstanceOf(AgentError);
    });
  });

  describe("ErrorCode constants", () => {
    it("should have correct string values", () => {
      expect(ErrorCode.TOOL_EXECUTION_ERROR).toBe("TOOL_EXECUTION_ERROR");
      expect(ErrorCode.PROVIDER_ERROR).toBe("PROVIDER_ERROR");
      expect(ErrorCode.PLUGIN_LOAD_ERROR).toBe("PLUGIN_LOAD_ERROR");
      expect(ErrorCode.SECURITY_ERROR).toBe("SECURITY_ERROR");
      expect(ErrorCode.TRANSPORT_ERROR).toBe("TRANSPORT_ERROR");
      expect(ErrorCode.TRANSPORT_CONNECTION_ERROR).toBe("TRANSPORT_CONNECTION_ERROR");
      expect(ErrorCode.TRANSPORT_SEND_ERROR).toBe("TRANSPORT_SEND_ERROR");
      expect(ErrorCode.SESSION_ERROR).toBe("SESSION_ERROR");
      expect(ErrorCode.SESSION_NOT_FOUND).toBe("SESSION_NOT_FOUND");
      expect(ErrorCode.SESSION_INVALID_OPERATION).toBe("SESSION_INVALID_OPERATION");
      expect(ErrorCode.CONFIG_ERROR).toBe("CONFIG_ERROR");
      expect(ErrorCode.CONFIG_VALIDATION_ERROR).toBe("CONFIG_VALIDATION_ERROR");
    });
  });

  describe("Existing error types backward compatibility", () => {
    it("ToolExecutionError should preserve cause via super", () => {
      const rootCause = new Error("file not found");
      const err = new ToolExecutionError("read_file", "failed to read", rootCause);
      expect(err.cause).toBe(rootCause);
      expect(err.code).toBe("TOOL_EXECUTION_ERROR");
      expect(err.toolName).toBe("read_file");
    });

    it("PluginLoadError should preserve cause via super", () => {
      const rootCause = new Error("module not found");
      const err = new PluginLoadError("test-plugin", "failed to load", rootCause);
      expect(err.cause).toBe(rootCause);
      expect(err.code).toBe("PLUGIN_LOAD_ERROR");
      expect(err.pluginName).toBe("test-plugin");
    });
  });
});
