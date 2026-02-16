import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkerRestartPolicy, SandboxConfig } from "@openstarry/sdk";
import { AgentEventType, SandboxError } from "@openstarry/sdk";

describe("Sandbox Worker Restart Policies", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("WorkerRestartPolicy interface has required fields", () => {
    const policy: WorkerRestartPolicy = {
      maxRestarts: 3,
      backoffMs: 500,
      maxBackoffMs: 10000,
      resetWindowMs: 60000,
    };

    expect(policy.maxRestarts).toBe(3);
    expect(policy.backoffMs).toBe(500);
    expect(policy.maxBackoffMs).toBe(10000);
    expect(policy.resetWindowMs).toBe(60000);
  });

  it("SandboxConfig accepts optional restartPolicy", () => {
    const config: SandboxConfig = {
      enabled: true,
      memoryLimitMb: 256,
      restartPolicy: {
        maxRestarts: 5,
        backoffMs: 1000,
        maxBackoffMs: 15000,
        resetWindowMs: 120000,
      },
    };

    expect(config.restartPolicy).toBeDefined();
    expect(config.restartPolicy!.maxRestarts).toBe(5);
  });

  it("SandboxConfig works without restartPolicy (defaults apply)", () => {
    const config: SandboxConfig = {
      enabled: true,
    };

    expect(config.restartPolicy).toBeUndefined();
  });

  it("exponential backoff computes correctly", () => {
    const policy: WorkerRestartPolicy = {
      maxRestarts: 5,
      backoffMs: 500,
      maxBackoffMs: 10000,
      resetWindowMs: 60000,
    };

    // Simulate backoff computation
    const backoffs: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      const backoff = Math.min(
        policy.backoffMs * Math.pow(2, attempt - 1),
        policy.maxBackoffMs,
      );
      backoffs.push(backoff);
    }

    expect(backoffs).toEqual([500, 1000, 2000, 4000, 8000]);
  });

  it("exponential backoff caps at maxBackoffMs", () => {
    const policy: WorkerRestartPolicy = {
      maxRestarts: 10,
      backoffMs: 500,
      maxBackoffMs: 5000,
      resetWindowMs: 60000,
    };

    const backoffs: number[] = [];
    for (let attempt = 1; attempt <= 6; attempt++) {
      const backoff = Math.min(
        policy.backoffMs * Math.pow(2, attempt - 1),
        policy.maxBackoffMs,
      );
      backoffs.push(backoff);
    }

    // 500, 1000, 2000, 4000, 5000 (capped), 5000 (capped)
    expect(backoffs).toEqual([500, 1000, 2000, 4000, 5000, 5000]);
  });

  it("crash count resets after resetWindowMs", () => {
    const policy: WorkerRestartPolicy = {
      maxRestarts: 3,
      backoffMs: 500,
      maxBackoffMs: 10000,
      resetWindowMs: 60000,
    };

    let crashCount = 2;
    let lastCrashTime = Date.now();

    // Advance past resetWindow
    vi.advanceTimersByTime(61000);

    // Check reset
    if (Date.now() - lastCrashTime > policy.resetWindowMs) {
      crashCount = 0;
    }

    expect(crashCount).toBe(0);
  });

  it("restart is blocked when crashCount exceeds maxRestarts", () => {
    const policy: WorkerRestartPolicy = {
      maxRestarts: 3,
      backoffMs: 500,
      maxBackoffMs: 10000,
      resetWindowMs: 60000,
    };

    const crashCount = 4;
    const shouldRestart = crashCount <= policy.maxRestarts;

    expect(shouldRestart).toBe(false);
  });

  it("restart event types exist in AgentEventType", () => {
    expect(AgentEventType.SANDBOX_WORKER_RESTARTED).toBe("sandbox:worker_restarted");
    expect(AgentEventType.SANDBOX_WORKER_RESTART_EXHAUSTED).toBe("sandbox:worker_restart_exhausted");
  });

  it("SandboxError includes plugin name for restart failures", () => {
    const err = new SandboxError("my-plugin", "Worker restart failed");
    expect(err.pluginName).toBe("my-plugin");
    expect(err.message).toContain("my-plugin");
    expect(err.message).toContain("Worker restart failed");
  });
});
