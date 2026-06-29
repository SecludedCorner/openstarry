/**
 * supervisor — restart-set selection (Fractal Society SupervisorStrategy).
 */

import { describe, it, expect } from "vitest";
import { selectRestartSet, withinRestartBudget, type SupervisionEntry } from "../../src/daemon/supervisor.js";

function entry(strategy: SupervisionEntry["strategy"], order: number, restartCount = 0, maxRestarts = 3): SupervisionEntry {
  return { strategy, order, restartCount, maxRestarts };
}

/** A,B,C supervised in that order, all with the same strategy. */
function group(strategy: SupervisionEntry["strategy"]): Map<string, SupervisionEntry> {
  return new Map([
    ["a", entry(strategy, 0)],
    ["b", entry(strategy, 1)],
    ["c", entry(strategy, 2)],
  ]);
}

describe("supervisor.selectRestartSet", () => {
  it("one-for-one restarts only the crashed child", () => {
    expect(selectRestartSet("b", group("one-for-one"))).toEqual(["b"]);
  });

  it("one-for-all restarts the whole group (in supervise order)", () => {
    expect(selectRestartSet("b", group("one-for-all"))).toEqual(["a", "b", "c"]);
  });

  it("rest-for-one restarts the crashed child + those supervised after it", () => {
    expect(selectRestartSet("b", group("rest-for-one"))).toEqual(["b", "c"]);
  });

  it("rest-for-one on the first child restarts everyone", () => {
    expect(selectRestartSet("a", group("rest-for-one"))).toEqual(["a", "b", "c"]);
  });

  it("rest-for-one on the last child restarts only it", () => {
    expect(selectRestartSet("c", group("rest-for-one"))).toEqual(["c"]);
  });

  it("returns [] for an unknown child", () => {
    expect(selectRestartSet("zzz", group("one-for-all"))).toEqual([]);
  });

  it("the crashed child's strategy drives the incident (mixed group)", () => {
    const m = new Map<string, SupervisionEntry>([
      ["a", entry("one-for-one", 0)],
      ["b", entry("one-for-all", 1)],
    ]);
    expect(selectRestartSet("a", m)).toEqual(["a"]); // a is one-for-one
    expect(selectRestartSet("b", m)).toEqual(["a", "b"]); // b is one-for-all
  });
});

describe("supervisor.withinRestartBudget", () => {
  it("allows restart while under the cap and stops at the cap", () => {
    expect(withinRestartBudget(entry("one-for-one", 0, 0, 3))).toBe(true);
    expect(withinRestartBudget(entry("one-for-one", 0, 2, 3))).toBe(true);
    expect(withinRestartBudget(entry("one-for-one", 0, 3, 3))).toBe(false);
  });
});
