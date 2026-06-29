/**
 * Tests for the per-parent, restart-persistent GenerationCounter
 * (Fractal Society Phase 1 / Spec Addendum A).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { GenerationCounter } from "../../src/daemon/generation-counter.js";

describe("GenerationCounter", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gen-counter-test-"));
  });
  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("counts each parent from 1, monotonically", () => {
    const c = new GenerationCounter(dir);
    expect(c.next("parent-a")).toBe(1);
    expect(c.next("parent-a")).toBe(2);
    expect(c.next("parent-a")).toBe(3);
  });

  it("counts each parent independently (per-parent, not global)", () => {
    const c = new GenerationCounter(dir);
    expect(c.next("parent-a")).toBe(1);
    expect(c.next("parent-b")).toBe(1); // B starts from 1, not 2
    expect(c.next("parent-a")).toBe(2);
    expect(c.next("parent-b")).toBe(2);
  });

  it("current() reports last issued without advancing", () => {
    const c = new GenerationCounter(dir);
    expect(c.current("p")).toBe(0);
    c.next("p");
    c.next("p");
    expect(c.current("p")).toBe(2);
    expect(c.current("p")).toBe(2); // no advance
  });

  it("persists across instances (restart survives)", () => {
    const c1 = new GenerationCounter(dir);
    c1.next("p"); // 1
    c1.next("p"); // 2
    const c2 = new GenerationCounter(dir); // fresh instance, same dir = "restart"
    expect(c2.next("p")).toBe(3); // continues, does not reset
  });

  it("writes atomically — no .tmp left behind", () => {
    const c = new GenerationCounter(dir);
    c.next("p");
    const leftovers = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("fail-open on a corrupt counter file: starts from 0 + WARN", () => {
    const onWarn = vi.fn();
    const c = new GenerationCounter(dir, onWarn);
    // Pre-seed a corrupt file for parent "p" (file stem = safeId("p")).
    writeFileSync(join(dir, "p.count"), "not-a-number", "utf-8");
    expect(c.next("p")).toBe(1); // treated as 0 → next is 1
    expect(onWarn).toHaveBeenCalledOnce();
    expect(String(onWarn.mock.calls[0][0])).toContain("corrupt");
  });

  it("sanitizes unsafe agentIds into a safe filename (no crash)", () => {
    const c = new GenerationCounter(dir);
    const weird = "a/b:c*?<>";
    expect(c.next(weird)).toBe(1);
    expect(c.next(weird)).toBe(2);
    // a file was written, and it is not a path-traversal escape
    const files = readdirSync(dir);
    expect(files.length).toBe(1);
    expect(files[0]).not.toContain("/");
  });
});
