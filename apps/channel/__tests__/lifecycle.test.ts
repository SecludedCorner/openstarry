import { describe, it, expect, vi, afterEach } from "vitest";
import { Channel } from "../src/index.js";

describe("Channel Lifecycle (Plan38 C4)", () => {
  let channel: Channel;

  afterEach(() => {
    if (channel) channel.forceTerminate();
  });

  it("transitions STARTING → RUNNING on start()", async () => {
    // Mock stdout to capture READY signal
    const written: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    channel = new Channel({ channelId: "test-ch", gracePeriodMs: 50 });
    expect(channel.getState()).toBe('STARTING');

    await channel.start();
    expect(channel.getState()).toBe('RUNNING');

    // Plan39 W3: READY signal is now structured JSON (ReadySignal), not plain "READY\n"
    expect(written).toHaveLength(1);
    const parsed = JSON.parse(written[0].trim()) as Record<string, unknown>;
    expect(parsed.type).toBe('READY');
    expect(parsed.channelId).toBe('test-ch');

    writeSpy.mockRestore();
  });

  it("transitions RUNNING → DRAINING → TERMINATED on shutdown()", async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    channel = new Channel({ channelId: "test-ch", gracePeriodMs: 50 });
    await channel.start();

    const shutdownPromise = channel.shutdown();
    expect(channel.getState()).toBe('DRAINING');

    await shutdownPromise;
    expect(channel.getState()).toBe('TERMINATED');

    writeSpy.mockRestore();
  });

  it("forceTerminate() skips grace period", async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    channel = new Channel({ channelId: "test-ch", gracePeriodMs: 60000 });
    await channel.start();
    channel.forceTerminate();
    expect(channel.getState()).toBe('TERMINATED');

    writeSpy.mockRestore();
  });

  it("Tenet #7: channel has zero @openstarry/core imports", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = resolve(fileURLToPath(import.meta.url), "../../src");
    const { globSync } = await import("node:fs");

    // Read all .ts files in src/
    const fs = await import("node:fs");
    const path = await import("node:path");
    const files: string[] = [];
    function walk(d: string) {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.ts')) files.push(p);
      }
    }
    walk(dir);

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/@openstarry\/core/);
    }
  });
});
