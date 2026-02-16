/**
 * Worker pool for pre-spawning and reusing sandbox workers.
 */

import { Worker } from "node:worker_threads";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("WorkerPool");

export interface WorkerPoolConfig {
  poolSize: number;
  memoryLimitMb: number;
  workerScriptPath: string;
}

export interface PluginWorkerPool {
  /** Initialize pool (spawn idle workers) */
  initialize(config: WorkerPoolConfig): Promise<void>;

  /** Acquire worker from pool or spawn new one if exhausted */
  acquire(pluginName: string): Promise<Worker>;

  /** Release worker back to pool (send RESET, return to idle) */
  release(pluginName: string): Promise<void>;

  /** Shutdown all workers (used in shutdownAll) */
  shutdown(): Promise<void>;

  /** Get pool stats for debugging */
  getStats(): { idle: number; busy: number; total: number };
}

const RESET_TIMEOUT_MS = 5000;

export function createWorkerPool(): PluginWorkerPool {
  let idle: Worker[] = [];
  const busy = new Map<string, Worker>();
  let config: WorkerPoolConfig | undefined;

  function spawnWorker(): Worker {
    if (!config) throw new Error("Worker pool not initialized");
    return new Worker(config.workerScriptPath, {
      resourceLimits: { maxOldGenerationSizeMb: config.memoryLimitMb },
    });
  }

  return {
    async initialize(cfg: WorkerPoolConfig): Promise<void> {
      config = cfg;

      if (cfg.poolSize <= 0) {
        logger.info("Worker pool disabled (poolSize=0)");
        return;
      }

      logger.info(`Initializing worker pool with ${cfg.poolSize} workers (${cfg.memoryLimitMb}MB each)`);

      for (let i = 0; i < cfg.poolSize; i++) {
        const worker = spawnWorker();
        idle.push(worker);
      }

      logger.info(`Worker pool initialized: ${idle.length} idle workers`);
    },

    async acquire(pluginName: string): Promise<Worker> {
      const worker = idle.pop();
      if (worker) {
        busy.set(pluginName, worker);
        logger.info(`Acquired pooled worker for plugin: ${pluginName} (idle: ${idle.length})`);
        return worker;
      }

      // Pool exhausted — spawn new worker dynamically
      const newWorker = spawnWorker();
      busy.set(pluginName, newWorker);
      logger.info(`Pool exhausted, spawned dynamic worker for plugin: ${pluginName}`);
      return newWorker;
    },

    async release(pluginName: string): Promise<void> {
      const worker = busy.get(pluginName);
      if (!worker) return;

      // Send RESET to clear plugin state
      worker.postMessage({ type: "RESET" });

      // Wait for RESET_COMPLETE acknowledgment (with timeout)
      await Promise.race([
        new Promise<void>((resolve) => {
          const handler = (msg: { type: string }) => {
            if (msg.type === "RESET_COMPLETE") {
              worker.off("message", handler);
              resolve();
            }
          };
          worker.on("message", handler);
        }),
        new Promise<void>((resolve) => setTimeout(resolve, RESET_TIMEOUT_MS)),
      ]);

      busy.delete(pluginName);
      idle.push(worker);
      logger.info(`Released worker back to pool: ${pluginName} (idle: ${idle.length})`);
    },

    async shutdown(): Promise<void> {
      const allWorkers = [...idle, ...busy.values()];
      logger.info(`Shutting down worker pool: ${allWorkers.length} workers`);

      await Promise.all(
        allWorkers.map((w) => w.terminate().catch(() => {})),
      );

      idle = [];
      busy.clear();
    },

    getStats() {
      return {
        idle: idle.length,
        busy: busy.size,
        total: idle.length + busy.size,
      };
    },
  };
}
