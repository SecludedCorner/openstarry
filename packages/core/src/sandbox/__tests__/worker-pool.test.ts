import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWorkerPool, type PluginWorkerPool, type WorkerPoolConfig } from "../worker-pool.js";

// Mock Worker class
vi.mock("node:worker_threads", () => {
  const { EventEmitter } = require("node:events");

  class MockWorker extends EventEmitter {
    resourceLimits: { maxOldGenerationSizeMb: number };
    terminated = false;

    constructor(_path: string, opts?: { resourceLimits?: { maxOldGenerationSizeMb?: number } }) {
      super();
      this.resourceLimits = { maxOldGenerationSizeMb: opts?.resourceLimits?.maxOldGenerationSizeMb ?? 512 };
    }

    postMessage(msg: { type: string }) {
      if (msg.type === "RESET") {
        // Simulate async RESET_COMPLETE response
        setTimeout(() => {
          this.emit("message", { type: "RESET_COMPLETE" });
        }, 10);
      }
    }

    async terminate() {
      this.terminated = true;
      return 0;
    }
  }

  return { Worker: MockWorker };
});

describe("Worker Pool", () => {
  let pool: PluginWorkerPool;

  beforeEach(() => {
    pool = createWorkerPool();
  });

  afterEach(async () => {
    await pool.shutdown();
  });

  it("initializes pool with N workers", async () => {
    await pool.initialize({
      poolSize: 4,
      memoryLimitMb: 512,
      workerScriptPath: "/fake/worker.js",
    });

    const stats = pool.getStats();
    expect(stats.idle).toBe(4);
    expect(stats.busy).toBe(0);
    expect(stats.total).toBe(4);
  });

  it("acquires worker from pool", async () => {
    await pool.initialize({
      poolSize: 2,
      memoryLimitMb: 512,
      workerScriptPath: "/fake/worker.js",
    });

    const worker = await pool.acquire("plugin-a");
    expect(worker).toBeDefined();

    const stats = pool.getStats();
    expect(stats.idle).toBe(1);
    expect(stats.busy).toBe(1);
    expect(stats.total).toBe(2);
  });

  it("falls back to dynamic spawn when pool exhausted", async () => {
    await pool.initialize({
      poolSize: 1,
      memoryLimitMb: 512,
      workerScriptPath: "/fake/worker.js",
    });

    await pool.acquire("plugin-a");
    const worker2 = await pool.acquire("plugin-b");

    // Second acquire should spawn dynamically
    expect(worker2).toBeDefined();

    const stats = pool.getStats();
    expect(stats.idle).toBe(0);
    expect(stats.busy).toBe(2);
    expect(stats.total).toBe(2);
  });

  it("releases worker back to pool", async () => {
    await pool.initialize({
      poolSize: 2,
      memoryLimitMb: 512,
      workerScriptPath: "/fake/worker.js",
    });

    await pool.acquire("plugin-a");

    const statsBefore = pool.getStats();
    expect(statsBefore.idle).toBe(1);
    expect(statsBefore.busy).toBe(1);

    await pool.release("plugin-a");

    const statsAfter = pool.getStats();
    expect(statsAfter.idle).toBe(2);
    expect(statsAfter.busy).toBe(0);
  });

  it("release is no-op for unknown plugin", async () => {
    await pool.initialize({
      poolSize: 2,
      memoryLimitMb: 512,
      workerScriptPath: "/fake/worker.js",
    });

    // Should not throw
    await pool.release("nonexistent");

    const stats = pool.getStats();
    expect(stats.idle).toBe(2);
  });

  it("shutdown terminates all workers", async () => {
    await pool.initialize({
      poolSize: 3,
      memoryLimitMb: 512,
      workerScriptPath: "/fake/worker.js",
    });

    await pool.acquire("plugin-a");

    await pool.shutdown();

    const stats = pool.getStats();
    expect(stats.idle).toBe(0);
    expect(stats.busy).toBe(0);
    expect(stats.total).toBe(0);
  });

  it("stats report correct counts", async () => {
    await pool.initialize({
      poolSize: 4,
      memoryLimitMb: 512,
      workerScriptPath: "/fake/worker.js",
    });

    await pool.acquire("plugin-a");
    await pool.acquire("plugin-b");

    const stats = pool.getStats();
    expect(stats).toEqual({ idle: 2, busy: 2, total: 4 });
  });

  it("pool with size 0 spawns dynamically on acquire", async () => {
    await pool.initialize({
      poolSize: 0,
      memoryLimitMb: 512,
      workerScriptPath: "/fake/worker.js",
    });

    const stats0 = pool.getStats();
    expect(stats0.total).toBe(0);

    const worker = await pool.acquire("plugin-a");
    expect(worker).toBeDefined();

    const stats1 = pool.getStats();
    expect(stats1.busy).toBe(1);
    expect(stats1.idle).toBe(0);
  });

  it("reuses worker after release for different plugin", async () => {
    await pool.initialize({
      poolSize: 1,
      memoryLimitMb: 512,
      workerScriptPath: "/fake/worker.js",
    });

    const worker1 = await pool.acquire("plugin-a");
    await pool.release("plugin-a");
    const worker2 = await pool.acquire("plugin-b");

    // Same worker instance should be reused
    expect(worker2).toBe(worker1);
  });
});
