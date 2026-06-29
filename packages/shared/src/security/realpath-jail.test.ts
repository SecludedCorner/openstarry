/**
 * Tests for the shared realpath jail — the single source of truth for symlink-aware
 * path confinement used by core's SecurityLayer and filesystem plugins (v0.59.9).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, symlinkSync } from "node:fs";
import { SecurityError } from "@openstarry/sdk";
import { safeRealpath, isWithinRoots, realpathJail } from "./realpath-jail.js";

describe("isWithinRoots", () => {
  it("matches exact root and descendants (both separators)", () => {
    expect(isWithinRoots("/a/b", ["/a/b"])).toBe(true);
    expect(isWithinRoots("/a/b/c.txt", ["/a/b"])).toBe(true);
    expect(isWithinRoots("C:\\a\\b\\c.txt", ["C:\\a\\b"])).toBe(true);
  });
  it("rejects siblings and prefix-spoofs", () => {
    expect(isWithinRoots("/a/bc", ["/a/b"])).toBe(false); // not /a/b + separator
    expect(isWithinRoots("/x", ["/a/b"])).toBe(false);
    expect(isWithinRoots("/a/b", [])).toBe(false);
  });
});

describe("safeRealpath", () => {
  it("is idempotent on an already-real path and resolves a nonexistent target via its parent", () => {
    const dir = mkdtempSync(join(tmpdir(), "jail-realpath-"));
    try {
      expect(safeRealpath(dir)).toBe(safeRealpath(safeRealpath(dir)));
      // nonexistent child: resolves to realParent + tail (does not throw)
      const child = join(dir, "does-not-exist.txt");
      expect(safeRealpath(child)).toBe(join(safeRealpath(dir), "does-not-exist.txt"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("realpathJail", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "jail-root-"));
    outside = mkdtempSync(join(tmpdir(), "jail-outside-"));
    mkdirSync(join(root, "data"));
    writeFileSync(join(outside, "secret.txt"), "TOP SECRET");
    symlinkSync(outside, join(root, "data", "escape"), "junction");
  });

  afterEach(() => {
    for (const d of [root, outside]) {
      try { if (existsSync(d)) rmSync(d, { recursive: true, force: true }); } catch { /* win32 best-effort */ }
    }
  });

  it("allows a path inside an allowed root (relative to workingDirectory)", () => {
    writeFileSync(join(root, "data", "ok.txt"), "x");
    const out = realpathJail("data/ok.txt", { workingDirectory: root, allowedPaths: [root] });
    expect(out).toBe(join(safeRealpath(root), "data", "ok.txt"));
  });

  it("allows a not-yet-existing new file in a real allowed dir (parent-realpath fallback)", () => {
    expect(() =>
      realpathJail("data/fresh.txt", { workingDirectory: root, allowedPaths: [root] }),
    ).not.toThrow();
  });

  it("rejects a path that lexically escapes via ..", () => {
    expect(() =>
      realpathJail("../escape.txt", { workingDirectory: root, allowedPaths: [root] }),
    ).toThrow(SecurityError);
  });

  it("rejects an absolute path outside all roots", () => {
    expect(() =>
      realpathJail(join(outside, "secret.txt"), { workingDirectory: root, allowedPaths: [root] }),
    ).toThrow(SecurityError);
  });

  it("rejects traversal THROUGH an in-jail symlink that targets outside (the lexical check could not)", () => {
    expect(() =>
      realpathJail("data/escape/secret.txt", { workingDirectory: root, allowedPaths: [root] }),
    ).toThrow(SecurityError);
  });
});
