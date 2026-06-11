import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IDistributedAlaya, ISeed, SeedFilter, SeedPropagationEvent, ExchangeResult } from "../../index.js";

describe("IDistributedAlaya (Plan38 C14 — AC-7 Interface)", () => {
  it("Two Truths Declaration is present in source", () => {
    const srcPath = resolve(fileURLToPath(import.meta.url), "../../distributed-alaya.ts");
    const source = readFileSync(srcPath, "utf-8");
    expect(source).toMatch(/Two Truths Declaration/);
    expect(source).toMatch(/samvriti-satya/);
    expect(source).toMatch(/consciousness stream/);
  });

  it("FROZEN marker is present", () => {
    const srcPath = resolve(fileURLToPath(import.meta.url), "../../distributed-alaya.ts");
    const source = readFileSync(srcPath, "utf-8");
    expect(source).toMatch(/FROZEN/);
  });

  it("ISeed satisfies interface structure", () => {
    const seed: ISeed = {
      seedId: "s1",
      agentId: "agent-1",
      skandha: "vijnana",
      content: { key: "value" },
      visibility: "private",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(seed.seedId).toBe("s1");
    expect(seed.signature).toBeUndefined();
  });

  it("SeedFilter accepts partial fields", () => {
    const filter: SeedFilter = { skandha: "samjna" };
    expect(filter.agentId).toBeUndefined();
  });

  it("SeedPropagationEvent has authorization field (future capability-gated)", () => {
    const event: SeedPropagationEvent = {
      seedId: "s1",
      fromAgentId: "a",
      toAgentIds: ["b"],
      authorization: "cap-token",
      timestamp: Date.now(),
    };
    expect(event.authorization).toBe("cap-token");
  });
});
