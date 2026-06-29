/**
 * GenerationCounter — per-parent, restart-persistent birth-order counter.
 *
 * Fractal Society Phase 1 (Spec Addendum A, 2026-06-26). Each parent agent
 * counts its OWN children from 1 (parent A's children are A's #1, #2, …).
 * Keeping it per-parent — not a single global counter — keeps the numbers
 * small and meaningful, and avoids a cross-daemon write race: handleSpawnChild's
 * parentId is always the spawning daemon's own agentId, so each daemon writes
 * only its own counter file.
 *
 * Storage: <baseDir>/<safeParentId>.count (one integer). Atomic tmp+rename.
 * fail-open: a missing / corrupt / unreadable file is treated as "start from 0"
 * — consistent with the in-memory agentRegistry being rebuilt from scratch on
 * restart — and surfaces a WARN via the optional onWarn hook. (A persist
 * failure keeps this run monotonic via the cache; only a restart could re-issue
 * a number, which is the accepted fail-open tradeoff.)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

/** Map an agentId to a filesystem-safe counter filename stem. */
function safeId(agentId: string): string {
  return agentId.replace(/[^A-Za-z0-9._-]/g, "_");
}

export interface IGenerationCounter {
  /** Next per-parent birth-order (1-based), persisted before returning. */
  next(parentId: string): number;
  /** Current last-issued value for a parent (0 if none). Diagnostic/test. */
  current(parentId: string): number;
}

export class GenerationCounter implements IGenerationCounter {
  private readonly baseDir: string;
  private readonly onWarn: (msg: string) => void;
  private readonly cache = new Map<string, number>();

  constructor(baseDir: string, onWarn: (msg: string) => void = () => {}) {
    this.baseDir = baseDir;
    this.onWarn = onWarn;
  }

  private fileFor(parentId: string): string {
    return join(this.baseDir, `${safeId(parentId)}.count`);
  }

  private read(parentId: string): number {
    const cached = this.cache.get(parentId);
    if (cached !== undefined) return cached;

    const file = this.fileFor(parentId);
    let value = 0;
    if (existsSync(file)) {
      try {
        const raw = readFileSync(file, "utf-8").trim();
        const n = Number.parseInt(raw, 10);
        if (Number.isInteger(n) && n >= 0) {
          value = n;
        } else {
          this.onWarn(`generation-counter: corrupt value in ${file} ("${raw}") — starting from 0`);
        }
      } catch (err) {
        this.onWarn(
          `generation-counter: cannot read ${file} (${err instanceof Error ? err.message : String(err)}) — starting from 0`,
        );
      }
    }
    this.cache.set(parentId, value);
    return value;
  }

  next(parentId: string): number {
    const value = this.read(parentId) + 1;
    this.cache.set(parentId, value);
    this.persist(parentId, value);
    return value;
  }

  current(parentId: string): number {
    return this.read(parentId);
  }

  private persist(parentId: string, value: number): void {
    const file = this.fileFor(parentId);
    try {
      if (!existsSync(this.baseDir)) mkdirSync(this.baseDir, { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, String(value), "utf-8");
      renameSync(tmp, file);
    } catch (err) {
      // fail-open: in-memory cache keeps this run monotonic; only a restart
      // after a persist failure could re-issue a number. WARN, do not throw.
      this.onWarn(
        `generation-counter: cannot persist ${file} (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }
}
