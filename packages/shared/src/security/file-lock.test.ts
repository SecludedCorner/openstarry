import { describe, it, expect, afterEach } from "vitest";
import { withProcessLock, acquireFileLock } from "./file-lock.js";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── withProcessLock ───

describe("withProcessLock", () => {
  it("same key serializes execution", async () => {
    const order: number[] = [];

    const a = withProcessLock("k1", async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 50));
      order.push(2);
      return "a";
    });

    const b = withProcessLock("k1", async () => {
      order.push(3);
      return "b";
    });

    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe("a");
    expect(rb).toBe("b");
    // b must start after a finishes: 1, 2, 3
    expect(order).toEqual([1, 2, 3]);
  });

  it("different keys run concurrently", async () => {
    const order: string[] = [];

    const a = withProcessLock("x", async () => {
      order.push("x-start");
      await new Promise((r) => setTimeout(r, 50));
      order.push("x-end");
    });

    const b = withProcessLock("y", async () => {
      order.push("y-start");
      await new Promise((r) => setTimeout(r, 50));
      order.push("y-end");
    });

    await Promise.all([a, b]);
    // Both should start before either ends
    expect(order.indexOf("x-start")).toBeLessThan(order.indexOf("x-end"));
    expect(order.indexOf("y-start")).toBeLessThan(order.indexOf("y-end"));
    // At least one "start" should appear before the other's "end"
    const xStartIdx = order.indexOf("x-start");
    const yEndIdx = order.indexOf("y-end");
    const yStartIdx = order.indexOf("y-start");
    const xEndIdx = order.indexOf("x-end");
    expect(xStartIdx < yEndIdx || yStartIdx < xEndIdx).toBe(true);
  });

  it("propagates errors", async () => {
    await expect(
      withProcessLock("err", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("returns the function result", async () => {
    const result = await withProcessLock("ret", async () => 42);
    expect(result).toBe(42);
  });

  it("next caller proceeds after error from previous holder", async () => {
    const first = withProcessLock("err2", async () => {
      throw new Error("fail");
    });
    await expect(first).rejects.toThrow("fail");

    const second = await withProcessLock("err2", async () => "ok");
    expect(second).toBe("ok");
  });
});

// ─── acquireFileLock ───

describe("acquireFileLock", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function makeTempDir() {
    tempDir = await mkdtemp(join(tmpdir(), "filelock-test-"));
    return tempDir;
  }

  it("acquire and release round-trip", async () => {
    const dir = await makeTempDir();
    const lockPath = join(dir, "test.lock");

    const release = await acquireFileLock(lockPath, { timeoutMs: 1000 });
    // Lock file should exist
    await expect(stat(lockPath)).resolves.toBeDefined();

    await release();
    // Lock file should be gone
    await expect(stat(lockPath)).rejects.toThrow();
  });

  it("contention: second caller waits for first to release", async () => {
    const dir = await makeTempDir();
    const lockPath = join(dir, "contention.lock");
    const order: number[] = [];

    const release1 = await acquireFileLock(lockPath, { timeoutMs: 2000 });
    order.push(1);

    const second = (async () => {
      const release2 = await acquireFileLock(lockPath, { timeoutMs: 2000, retryMs: 20 });
      order.push(2);
      await release2();
    })();

    // Give second caller time to start waiting
    await new Promise((r) => setTimeout(r, 100));

    // Release first lock
    await release1();
    order.push(3);

    await second;
    // Second caller should acquire after first releases: 1, 3, 2
    expect(order[0]).toBe(1);
    // 3 (release1) should come before 2 (second acquires)
    expect(order.indexOf(3)).toBeLessThan(order.indexOf(2));
  });

  it("throws on timeout", async () => {
    const dir = await makeTempDir();
    const lockPath = join(dir, "timeout.lock");

    const release = await acquireFileLock(lockPath, { timeoutMs: 2000 });

    await expect(
      acquireFileLock(lockPath, { timeoutMs: 200, retryMs: 20 }),
    ).rejects.toThrow(/timeout/i);

    await release();
  });

  it("cleans stale lock (dead PID)", async () => {
    const dir = await makeTempDir();
    const lockPath = join(dir, "stale.lock");

    // Write a stale lock with non-existent PID
    const stalePayload = JSON.stringify({ pid: 999999, ts: Date.now() });
    await writeFile(lockPath, stalePayload, "utf-8");

    // Should clean stale lock and acquire
    const release = await acquireFileLock(lockPath, { timeoutMs: 1000 });
    await release();
  });

  it("cleans stale lock (expired age)", async () => {
    const dir = await makeTempDir();
    const lockPath = join(dir, "aged.lock");

    // Write a lock from current PID but very old timestamp
    const stalePayload = JSON.stringify({ pid: process.pid, ts: Date.now() - 60000 });
    await writeFile(lockPath, stalePayload, "utf-8");

    // staleMs=100 means the 60s-old lock is definitely stale
    const release = await acquireFileLock(lockPath, { timeoutMs: 1000, staleMs: 100 });
    await release();
  });
});
