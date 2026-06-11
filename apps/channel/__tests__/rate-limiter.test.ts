import { describe, it, expect, beforeEach } from "vitest";
import { DualRateLimiter } from "../src/rate-limiter.js";
import { RateLimitError } from "@openstarry/sdk";

describe("TokenBucket (via DualRateLimiter)", () => {
  it("tryConsume returns true when tokens are available", () => {
    const limiter = new DualRateLimiter(5, 5, 1000);
    const bucket = limiter.getAgentBucket("agent-a");
    expect(bucket.tryConsume()).toBe(true);
  });

  it("tryConsume returns false when tokens exhausted", () => {
    const limiter = new DualRateLimiter(2, 2, 1000);
    const bucket = limiter.getAgentBucket("agent-a");
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it("availableTokens reflects consumed tokens", () => {
    const limiter = new DualRateLimiter(5, 5, 1000);
    const bucket = limiter.getAgentBucket("agent-b");
    expect(bucket.maxTokens).toBe(5);
    bucket.tryConsume();
    bucket.tryConsume();
    expect(bucket.availableTokens).toBe(3);
  });
});

describe("DualRateLimiter.checkAndConsume", () => {
  let limiter: DualRateLimiter;

  beforeEach(() => {
    // Low limits for testing: 3 per-agent, 2 per-target
    limiter = new DualRateLimiter(3, 2, 1000);
  });

  it("allows messages within both limits", () => {
    expect(() => limiter.checkAndConsume("agent-a", "agent-b")).not.toThrow();
    expect(() => limiter.checkAndConsume("agent-a", "agent-b")).not.toThrow();
  });

  it("throws RateLimitError with limitType per-target when per-target limit exceeded", () => {
    limiter.checkAndConsume("agent-a", "agent-b");
    limiter.checkAndConsume("agent-a", "agent-b");
    let err: RateLimitError | undefined;
    try {
      limiter.checkAndConsume("agent-a", "agent-b");
    } catch (e) {
      err = e as RateLimitError;
    }
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err?.limitType).toBe("per-target");
    expect(err?.agentId).toBe("agent-a");
    expect(err?.targetAgentId).toBe("agent-b");
  });

  it("throws RateLimitError with limitType per-agent when per-agent limit exceeded", () => {
    // Use different targets to avoid hitting per-target limit first
    limiter.checkAndConsume("agent-a", "target-1");
    limiter.checkAndConsume("agent-a", "target-2");
    limiter.checkAndConsume("agent-a", "target-3");
    let err: RateLimitError | undefined;
    try {
      limiter.checkAndConsume("agent-a", "target-4");
    } catch (e) {
      err = e as RateLimitError;
    }
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err?.limitType).toBe("per-agent");
    expect(err?.agentId).toBe("agent-a");
  });

  it("per-agent limit is checked before per-target limit", () => {
    // Exhaust per-agent limit across different targets
    limiter.checkAndConsume("agent-x", "t1");
    limiter.checkAndConsume("agent-x", "t2");
    limiter.checkAndConsume("agent-x", "t3");
    // Next call to any target should hit per-agent
    let err: RateLimitError | undefined;
    try {
      limiter.checkAndConsume("agent-x", "t1");
    } catch (e) {
      err = e as RateLimitError;
    }
    expect(err?.limitType).toBe("per-agent");
  });

  it("different agents have independent per-agent buckets", () => {
    // Exhaust agent-a
    limiter.checkAndConsume("agent-a", "target-1");
    limiter.checkAndConsume("agent-a", "target-2");
    limiter.checkAndConsume("agent-a", "target-3");
    // agent-b should still work
    expect(() => limiter.checkAndConsume("agent-b", "target-1")).not.toThrow();
  });

  it("different targets have independent per-target buckets", () => {
    // Exhaust agent-a -> target-1 per-target (2 msgs)
    limiter.checkAndConsume("agent-a", "target-1");
    limiter.checkAndConsume("agent-a", "target-1");
    // agent-a -> target-2 should still work (different target bucket)
    expect(() => limiter.checkAndConsume("agent-a", "target-2")).not.toThrow();
  });
});

describe("DualRateLimiter.clearAgent", () => {
  it("removes all buckets for the agent", () => {
    const limiter = new DualRateLimiter(2, 2, 1000);
    // Exhaust limits
    limiter.checkAndConsume("agent-z", "target-a");
    limiter.checkAndConsume("agent-z", "target-a");
    // Both per-target and per-agent exhausted for agent-z -> target-a
    expect(() => limiter.checkAndConsume("agent-z", "target-a")).toThrow(RateLimitError);
    // After clearAgent, buckets reset
    limiter.clearAgent("agent-z");
    expect(() => limiter.checkAndConsume("agent-z", "target-a")).not.toThrow();
  });

  it("clearAgent only removes the specified agent's buckets", () => {
    const limiter = new DualRateLimiter(2, 2, 1000);
    limiter.checkAndConsume("agent-1", "target-a");
    limiter.checkAndConsume("agent-2", "target-a");
    limiter.clearAgent("agent-1");
    // agent-2 buckets should still be intact
    const bucket = limiter.getAgentBucket("agent-2");
    expect(bucket.availableTokens).toBe(1);
  });
});

describe("DualRateLimiter diagnostics", () => {
  it("getAgentBucket returns bucket with correct maxTokens", () => {
    const limiter = new DualRateLimiter(100, 20, 1000);
    const bucket = limiter.getAgentBucket("agent-d");
    expect(bucket.maxTokens).toBe(100);
  });

  it("getTargetBucket returns bucket with correct maxTokens", () => {
    const limiter = new DualRateLimiter(100, 20, 1000);
    const bucket = limiter.getTargetBucket("agent-d", "target-x");
    expect(bucket.maxTokens).toBe(20);
  });

  it("uses SDK defaults when constructed with no args", () => {
    const limiter = new DualRateLimiter();
    const agentBucket = limiter.getAgentBucket("agent-default");
    const targetBucket = limiter.getTargetBucket("agent-default", "target-default");
    expect(agentBucket.maxTokens).toBe(100);
    expect(targetBucket.maxTokens).toBe(20);
  });
});
