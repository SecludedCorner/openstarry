import { describe, it, expect, vi } from "vitest";
import { createSecurityLayer } from "./guardrails.js";
import type { SessionConfig } from "@openstarry/sdk";

describe("SecurityLayer", () => {
  it("allows paths within the allowed scope", () => {
    const security = createSecurityLayer(["/home/user/project"]);

    expect(() => security.validatePath("/home/user/project/src/index.ts")).not.toThrow();
    expect(() => security.validatePath("/home/user/project")).not.toThrow();
  });

  it("blocks paths outside the allowed scope", () => {
    const security = createSecurityLayer(["/home/user/project"]);

    expect(() => security.validatePath("/etc/passwd")).toThrow();
    expect(() => security.validatePath("/home/user/other")).toThrow();
  });

  it("blocks path traversal attempts", () => {
    const security = createSecurityLayer(["/home/user/project"]);

    expect(() =>
      security.validatePath("/home/user/project/../../../etc/passwd"),
    ).toThrow();
  });

  it("supports multiple allowed paths", () => {
    const security = createSecurityLayer(["/home/user/a", "/home/user/b"]);

    expect(() => security.validatePath("/home/user/a/file.txt")).not.toThrow();
    expect(() => security.validatePath("/home/user/b/file.txt")).not.toThrow();
    expect(() => security.validatePath("/home/user/c/file.txt")).toThrow();
  });

  it("getAllowedPaths() returns a copy", () => {
    const security = createSecurityLayer(["/a", "/b"]);
    const paths = security.getAllowedPaths();

    expect(paths).toHaveLength(2);

    // Mutating returned array should not affect internals
    paths.push("/evil");
    expect(security.getAllowedPaths()).toHaveLength(2);
  });

  describe("Session Config Validation", () => {
    it("validates path with session allowedPaths (valid subset)", () => {
      const getSessionConfig = vi.fn((sessionId?: string): SessionConfig | undefined => {
        if (sessionId === "sess-1") {
          return { allowedPaths: ["/workspace/project"] };
        }
        return undefined;
      });

      const security = createSecurityLayer(["/workspace"], getSessionConfig);

      expect(() => security.validatePath("/workspace/project/file.txt", "sess-1")).not.toThrow();
      expect(getSessionConfig).toHaveBeenCalledWith("sess-1");
    });

    it("rejects session paths outside agent scope (logs warning, uses agent paths)", () => {
      const getSessionConfig = vi.fn((sessionId?: string): SessionConfig | undefined => {
        if (sessionId === "sess-2") {
          return { allowedPaths: ["/workspace", "/etc"] };
        }
        return undefined;
      });

      const security = createSecurityLayer(["/workspace"], getSessionConfig);

      // Session path /etc is invalid (not subset of agent paths)
      // Should use only valid subset: ["/workspace"]
      expect(() => security.validatePath("/workspace/file.txt", "sess-2")).not.toThrow();
      expect(() => security.validatePath("/etc/passwd", "sess-2")).toThrow();
    });

    it("falls back to agent paths when no session config", () => {
      const getSessionConfig = vi.fn((): SessionConfig | undefined => undefined);

      const security = createSecurityLayer(["/workspace"], getSessionConfig);

      expect(() => security.validatePath("/workspace/file.txt", "sess-3")).not.toThrow();
      expect(() => security.validatePath("/etc/passwd", "sess-3")).toThrow();
    });

    it("falls back to agent paths if sessionId is undefined", () => {
      const getSessionConfig = vi.fn();

      const security = createSecurityLayer(["/workspace"], getSessionConfig);

      expect(() => security.validatePath("/workspace/file.txt")).not.toThrow();
      expect(() => security.validatePath("/etc/passwd")).toThrow();
      expect(getSessionConfig).not.toHaveBeenCalled();
    });

    it("handles normalized session paths correctly", () => {
      const getSessionConfig = vi.fn((sessionId?: string): SessionConfig | undefined => {
        if (sessionId === "sess-4") {
          return { allowedPaths: ["/workspace/project/../project/src"] };
        }
        return undefined;
      });

      const security = createSecurityLayer(["/workspace"], getSessionConfig);

      // Normalized: /workspace/project/../project/src => /workspace/project/src
      expect(() => security.validatePath("/workspace/project/src/file.ts", "sess-4")).not.toThrow();
    });
  });
});
