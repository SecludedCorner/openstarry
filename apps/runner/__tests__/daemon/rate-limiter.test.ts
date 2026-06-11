import { describe, it, expect } from "vitest";
import { DualRateLimiter } from "../../src/daemon/rate-limiter.js";
import { RateLimitError } from "@openstarry/sdk";

describe("DualRateLimiter (Plan38 C16)", () => {
  it("allows messages under per-agent limit", () => {
    const rl = new DualRateLimiter({ agentLimit: 3, targetLimit: 10, windowMs: 1000 });
    rl.check("a", "b");
    rl.check("a", "b");
    rl.check("a", "b");
    // 3 messages, limit is 3 — exactly at limit, should all succeed
  });

  it("rejects when per-agent limit exceeded", () => {
    const rl = new DualRateLimiter({ agentLimit: 2, targetLimit: 10, windowMs: 1000 });
    rl.check("a", "b");
    rl.check("a", "c");
    expect(() => rl.check("a", "d")).toThrow(RateLimitError);
  });

  it("rejects when per-target limit exceeded", () => {
    const rl = new DualRateLimiter({ agentLimit: 100, targetLimit: 2, windowMs: 1000 });
    rl.check("a", "b");
    rl.check("a", "b");
    expect(() => rl.check("a", "b")).toThrow(RateLimitError);
  });

  it("different targets have independent limits", () => {
    const rl = new DualRateLimiter({ agentLimit: 100, targetLimit: 1, windowMs: 1000 });
    rl.check("a", "b");
    rl.check("a", "c"); // Different target, should work
    expect(() => rl.check("a", "b")).toThrow(RateLimitError); // Same target, over limit
  });

  it("removeAgent cleans up entries", () => {
    const rl = new DualRateLimiter({ agentLimit: 1, targetLimit: 1, windowMs: 1000 });
    rl.check("a", "b");
    rl.removeAgent("a");
    rl.check("a", "b"); // Should work after cleanup
  });

  it("per-agent check without target works", () => {
    const rl = new DualRateLimiter({ agentLimit: 2, targetLimit: 10, windowMs: 1000 });
    rl.check("a");
    rl.check("a");
    expect(() => rl.check("a")).toThrow(RateLimitError);
  });
});
