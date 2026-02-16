import { describe, it, expect, vi } from "vitest";
import type { SandboxConfig, SandboxAuditConfig, AuditLogEntry, WorkerRestartPolicy, PkiIntegrity } from "@openstarry/sdk";
import { AgentEventType } from "@openstarry/sdk";

describe("Sandbox Advanced Hardening Integration", () => {
  describe("SandboxConfig Plan07.2 fields", () => {
    it("accepts blockedModules field", () => {
      const config: SandboxConfig = {
        enabled: true,
        blockedModules: ["axios", "node-fetch"],
      };
      expect(config.blockedModules).toEqual(["axios", "node-fetch"]);
    });

    it("accepts allowedModules field", () => {
      const config: SandboxConfig = {
        enabled: true,
        allowedModules: ["fs", "path"],
      };
      expect(config.allowedModules).toEqual(["fs", "path"]);
    });

    it("combines all SandboxConfig fields", () => {
      const config: SandboxConfig = {
        enabled: true,
        memoryLimitMb: 1024,
        cpuTimeoutMs: 120000,
        restartPolicy: {
          maxRestarts: 5,
          backoffMs: 1000,
          maxBackoffMs: 15000,
          resetWindowMs: 120000,
        },
        allowedPaths: ["/tmp"],
        allowedDomains: ["api.example.com"],
        blockedModules: ["net"],
        allowedModules: ["fs"],
      };

      expect(config.enabled).toBe(true);
      expect(config.blockedModules).toContain("net");
      expect(config.allowedModules).toContain("fs");
    });
  });

  describe("PkiIntegrity type", () => {
    it("supports ed25519-sha256 algorithm", () => {
      const pki: PkiIntegrity = {
        algorithm: "ed25519-sha256",
        signature: "base64sig",
        publicKey: "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
      };
      expect(pki.algorithm).toBe("ed25519-sha256");
    });

    it("supports rsa-sha256 algorithm", () => {
      const pki: PkiIntegrity = {
        algorithm: "rsa-sha256",
        signature: "base64sig",
        publicKey: "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
      };
      expect(pki.algorithm).toBe("rsa-sha256");
    });

    it("accepts optional author and timestamp", () => {
      const pki: PkiIntegrity = {
        algorithm: "ed25519-sha256",
        signature: "base64sig",
        publicKey: "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
        author: "openstarry-team",
        timestamp: 1700000000000,
      };
      expect(pki.author).toBe("openstarry-team");
      expect(pki.timestamp).toBe(1700000000000);
    });
  });

  describe("Event types", () => {
    it("SANDBOX_IMPORT_BLOCKED event exists", () => {
      expect(AgentEventType.SANDBOX_IMPORT_BLOCKED).toBe("sandbox:import_blocked");
    });

    it("all Plan07 sandbox events exist", () => {
      // Plan07 MVP
      expect(AgentEventType.SANDBOX_WORKER_SPAWNED).toBe("sandbox:worker_spawned");
      expect(AgentEventType.SANDBOX_WORKER_CRASHED).toBe("sandbox:worker_crashed");
      expect(AgentEventType.SANDBOX_WORKER_SHUTDOWN).toBe("sandbox:worker_shutdown");
      expect(AgentEventType.SANDBOX_MEMORY_LIMIT_EXCEEDED).toBe("sandbox:memory_limit_exceeded");
      expect(AgentEventType.SANDBOX_SIGNATURE_VERIFIED).toBe("sandbox:signature_verified");
      expect(AgentEventType.SANDBOX_SIGNATURE_FAILED).toBe("sandbox:signature_failed");

      // Plan07.1
      expect(AgentEventType.SANDBOX_WORKER_STALLED).toBe("sandbox:worker_stalled");
      expect(AgentEventType.SANDBOX_WORKER_RESTARTED).toBe("sandbox:worker_restarted");
      expect(AgentEventType.SANDBOX_WORKER_RESTART_EXHAUSTED).toBe("sandbox:worker_restart_exhausted");

      // Plan07.2
      expect(AgentEventType.SANDBOX_IMPORT_BLOCKED).toBe("sandbox:import_blocked");
    });
  });

  describe("Message protocol", () => {
    it("RESET and RESET_COMPLETE message types are valid", async () => {
      const { default: messagesModule } = await import("../messages.js") as { default: undefined };
      // The types exist at compile time — we just verify the import works
      // and the union type includes them (TypeScript compile-time check)
      type ResetMsg = import("../messages.js").ResetMessage;
      type ResetCompleteMsg = import("../messages.js").ResetCompleteMessage;

      const resetMsg: ResetMsg = { type: "RESET" };
      const resetCompleteMsg: ResetCompleteMsg = { type: "RESET_COMPLETE" };

      expect(resetMsg.type).toBe("RESET");
      expect(resetCompleteMsg.type).toBe("RESET_COMPLETE");
    });
  });

  describe("Import analyzer module", () => {
    it("exports validatePluginImports function", async () => {
      const mod = await import("../import-analyzer.js");
      expect(typeof mod.validatePluginImports).toBe("function");
    });
  });

  describe("Worker pool module", () => {
    it("exports createWorkerPool function", async () => {
      const mod = await import("../worker-pool.js");
      expect(typeof mod.createWorkerPool).toBe("function");
    });

    it("pool has correct interface methods", async () => {
      const { createWorkerPool } = await import("../worker-pool.js");
      const pool = createWorkerPool();

      expect(typeof pool.initialize).toBe("function");
      expect(typeof pool.acquire).toBe("function");
      expect(typeof pool.release).toBe("function");
      expect(typeof pool.shutdown).toBe("function");
      expect(typeof pool.getStats).toBe("function");
    });
  });

  // ─── Plan07.3 Sandbox Final Hardening ───

  describe("SandboxConfig Plan07.3 fields", () => {
    it("accepts moduleInterception field", () => {
      const config: SandboxConfig = {
        enabled: true,
        moduleInterception: "strict",
      };
      expect(config.moduleInterception).toBe("strict");
    });

    it("accepts moduleInterception warn mode", () => {
      const config: SandboxConfig = {
        enabled: true,
        moduleInterception: "warn",
      };
      expect(config.moduleInterception).toBe("warn");
    });

    it("accepts moduleInterception off mode", () => {
      const config: SandboxConfig = {
        enabled: true,
        moduleInterception: "off",
      };
      expect(config.moduleInterception).toBe("off");
    });

    it("accepts auditLog field", () => {
      const config: SandboxConfig = {
        enabled: true,
        auditLog: {
          enabled: true,
          logDir: "/tmp/logs",
          bufferSize: 50,
          flushIntervalMs: 5000,
          maxFileSizeMb: 50,
          maxFiles: 10,
          sanitizeArgs: true,
        },
      };
      expect(config.auditLog?.enabled).toBe(true);
      expect(config.auditLog?.logDir).toBe("/tmp/logs");
    });
  });

  describe("SandboxAuditConfig type", () => {
    it("has all required and optional fields", () => {
      const config: SandboxAuditConfig = {
        enabled: true,
      };
      expect(config.enabled).toBe(true);
      expect(config.logDir).toBeUndefined();
      expect(config.bufferSize).toBeUndefined();
    });

    it("accepts all optional fields", () => {
      const config: SandboxAuditConfig = {
        enabled: true,
        logDir: "/var/log/sandbox",
        bufferSize: 100,
        flushIntervalMs: 10000,
        maxFileSizeMb: 100,
        maxFiles: 20,
        sanitizeArgs: false,
      };
      expect(config.bufferSize).toBe(100);
      expect(config.sanitizeArgs).toBe(false);
    });
  });

  describe("AuditLogEntry type", () => {
    it("creates valid audit log entry", () => {
      const entry: AuditLogEntry = {
        timestamp: new Date().toISOString(),
        level: "audit",
        pluginName: "test-plugin",
        category: "rpc",
        operation: "BUS_EMIT",
        method: "BUS_EMIT",
        result: "success",
        durationMs: 5,
      };
      expect(entry.level).toBe("audit");
      expect(entry.category).toBe("rpc");
    });

    it("supports all log levels", () => {
      const levels: AuditLogEntry["level"][] = ["info", "warn", "error", "audit"];
      for (const level of levels) {
        const entry: AuditLogEntry = {
          timestamp: new Date().toISOString(),
          level,
          pluginName: "test",
          category: "rpc",
          operation: "test",
        };
        expect(entry.level).toBe(level);
      }
    });

    it("supports all categories", () => {
      const categories: AuditLogEntry["category"][] = ["rpc", "worker", "tool", "lifecycle"];
      for (const category of categories) {
        const entry: AuditLogEntry = {
          timestamp: new Date().toISOString(),
          level: "info",
          pluginName: "test",
          category,
          operation: "test",
        };
        expect(entry.category).toBe(category);
      }
    });

    it("supports metadata with extensible fields", () => {
      const entry: AuditLogEntry = {
        timestamp: new Date().toISOString(),
        level: "info",
        pluginName: "test",
        category: "worker",
        operation: "spawn",
        metadata: {
          memoryLimitMb: 512,
          cpuTimeoutMs: 60000,
          crashCount: 0,
          customField: "custom-value",
        },
      };
      expect(entry.metadata?.memoryLimitMb).toBe(512);
      expect(entry.metadata?.customField).toBe("custom-value");
    });
  });

  describe("Plan07.3 Event types", () => {
    it("SANDBOX_MODULE_BLOCKED event exists", () => {
      expect(AgentEventType.SANDBOX_MODULE_BLOCKED).toBe("sandbox:module_blocked");
    });

    it("SANDBOX_AUDIT_LOG_ROTATED event exists", () => {
      expect(AgentEventType.SANDBOX_AUDIT_LOG_ROTATED).toBe("sandbox:audit_log_rotated");
    });

    it("SANDBOX_AUDIT_LOG_ERROR event exists", () => {
      expect(AgentEventType.SANDBOX_AUDIT_LOG_ERROR).toBe("sandbox:audit_log_error");
    });
  });

  describe("Audit logger module", () => {
    it("exports AuditLogger class", async () => {
      const mod = await import("../audit-logger.js");
      expect(typeof mod.AuditLogger).toBe("function");
    });

    it("exports sanitizeValue function", async () => {
      const mod = await import("../audit-logger.js");
      expect(typeof mod.sanitizeValue).toBe("function");
    });
  });
});
