/**
 * Tests for safe-regex utilities (SEC-029).
 * @see utils/safe-regex.ts
 */
import { describe, it, expect } from "vitest";
import { validateRegexSafety, safeRegexTest, DEFAULT_MAX_INPUT_LEN } from "../safe-regex.js";

describe("validateRegexSafety", () => {
  it("accepts safe patterns", () => {
    expect(validateRegexSafety("^foo$")).toBe(true);
    expect(validateRegexSafety("bar")).toBe(true);
    expect(validateRegexSafety("[a-z]+")).toBe(true);
    expect(validateRegexSafety("a{2,5}")).toBe(true);
  });

  it("rejects nested quantifier patterns", () => {
    expect(validateRegexSafety("(a+)+")).toBe(false);
    expect(validateRegexSafety("(a*)*")).toBe(false);
    expect(validateRegexSafety("(a{2,})+")).toBe(false);
  });

  it("accepts quantifier outside group without nested quantifier inside", () => {
    expect(validateRegexSafety("(abc)+")).toBe(true);
    expect(validateRegexSafety("(hello)?")).toBe(true);
  });

  // SEC-029-01 bypass vector tests
  it("rejects alternation inside quantified group (SEC-029-01)", () => {
    expect(validateRegexSafety("(a|aa)+")).toBe(false);
    expect(validateRegexSafety("(a|a?)+")).toBe(false);
    expect(validateRegexSafety("(foo|fooo)*")).toBe(false);
  });

  it("rejects nested quantified groups (SEC-029-01)", () => {
    expect(validateRegexSafety("((a)+)+")).toBe(false);
    expect(validateRegexSafety("((ab)*)+")).toBe(false);
  });

  it("rejects non-capturing group with nested quantifier (SEC-029-01)", () => {
    expect(validateRegexSafety("(?:a+)+")).toBe(false);
    expect(validateRegexSafety("(?:[a-z]+)*")).toBe(false);
  });

  it("accepts safe character class with quantifier", () => {
    expect(validateRegexSafety("[a-z]+")).toBe(true);
    expect(validateRegexSafety("[+*]+")).toBe(true);  // quantifier chars inside char class are safe
  });
});

describe("safeRegexTest", () => {
  it("returns true for matching safe pattern", () => {
    expect(safeRegexTest(/^read_file$/, "read_file")).toBe(true);
  });

  it("returns false for non-matching pattern", () => {
    expect(safeRegexTest(/^read_file$/, "write_file")).toBe(false);
  });

  it("rejects input exceeding maxInputLen", () => {
    const longInput = "a".repeat(DEFAULT_MAX_INPUT_LEN + 1);
    expect(safeRegexTest(/a/, longInput)).toBe(false);
  });

  it("accepts input at exactly maxInputLen", () => {
    const exactInput = "a".repeat(DEFAULT_MAX_INPUT_LEN);
    expect(safeRegexTest(/a/, exactInput)).toBe(true);
  });

  it("rejects unsafe regex pattern", () => {
    // (a+)+ is a nested quantifier — should be rejected
    const unsafePattern = new RegExp("(a+)+");
    expect(safeRegexTest(unsafePattern, "aaa")).toBe(false);
  });

  it("uses custom maxInputLen", () => {
    expect(safeRegexTest(/a/, "aaaa", 3)).toBe(false);
    expect(safeRegexTest(/a/, "aaa", 3)).toBe(true);
  });
});
