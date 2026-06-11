/**
 * Plan54 §7 — config + MAX_SPAWN_DEPTH override audit tests.
 * Batch 14 Item #6: tamper-evident audit log verification.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  MAX_SPAWN_DEPTH_DEFAULT,
  MAX_ACTIVE_SUBAGENTS_PER_PARENT,
  ORPHAN_GRACE_WINDOW_MS,
  resolveMaxSpawnDepth,
  resolveMaxActiveSubagentsGlobal,
  verifySpawnDepthAudit,
  type SpawnDepthOverrideAudit,
} from '../../src/agent-composition/config.js';

describe('Plan54 §7 — MAX_SPAWN_DEPTH constants', () => {
  it('default is 4 (R3 D-04 ratified 17/6)', () => {
    expect(MAX_SPAWN_DEPTH_DEFAULT).toBe(4);
  });

  it('per-parent cap is 8 (Plan54 §8)', () => {
    expect(MAX_ACTIVE_SUBAGENTS_PER_PARENT).toBe(8);
  });

  it('orphan grace window is 30 seconds', () => {
    expect(ORPHAN_GRACE_WINDOW_MS).toBe(30_000);
  });
});

describe('Plan54 §7.2 — resolveMaxSpawnDepth precedence', () => {
  let envSnapshot: string | undefined;
  beforeEach(() => {
    envSnapshot = process.env.OPENSTARRY_MAX_SPAWN_DEPTH;
    delete process.env.OPENSTARRY_MAX_SPAWN_DEPTH;
  });
  afterEach(() => {
    if (envSnapshot !== undefined) process.env.OPENSTARRY_MAX_SPAWN_DEPTH = envSnapshot;
    else delete process.env.OPENSTARRY_MAX_SPAWN_DEPTH;
  });

  it('returns default when no overrides supplied', () => {
    expect(resolveMaxSpawnDepth({})).toBe(MAX_SPAWN_DEPTH_DEFAULT);
  });

  it('per-spawn beats config beats env beats default', () => {
    process.env.OPENSTARRY_MAX_SPAWN_DEPTH = '5';
    expect(resolveMaxSpawnDepth({ perSpawn: 6, configFile: 7 })).toBe(6);
    expect(resolveMaxSpawnDepth({ configFile: 7 })).toBe(7);
    expect(resolveMaxSpawnDepth({})).toBe(5);
  });

  it('out-of-range values fall back to default (1..16)', () => {
    expect(resolveMaxSpawnDepth({ perSpawn: 0 })).toBe(MAX_SPAWN_DEPTH_DEFAULT);
    expect(resolveMaxSpawnDepth({ perSpawn: 17 })).toBe(MAX_SPAWN_DEPTH_DEFAULT);
    expect(resolveMaxSpawnDepth({ perSpawn: -1 })).toBe(MAX_SPAWN_DEPTH_DEFAULT);
    expect(resolveMaxSpawnDepth({ perSpawn: 3.5 })).toBe(MAX_SPAWN_DEPTH_DEFAULT);
  });

  it('emits a tamper-evident audit entry on every non-default resolution', () => {
    const audits: SpawnDepthOverrideAudit[] = [];
    resolveMaxSpawnDepth({ perSpawn: 6 }, (e) => audits.push(e));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.source).toBe('per_spawn');
    expect(audits[0]!.overriddenValue).toBe(6);
    expect(audits[0]!.defaultValue).toBe(MAX_SPAWN_DEPTH_DEFAULT);
    expect(audits[0]!.integrityMac).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does NOT emit audit entries for default-fallthrough', () => {
    const audits: SpawnDepthOverrideAudit[] = [];
    resolveMaxSpawnDepth({}, (e) => audits.push(e));
    expect(audits).toHaveLength(0);
  });

  it('verifySpawnDepthAudit detects tampering (Batch 14 Item #6)', () => {
    const audits: SpawnDepthOverrideAudit[] = [];
    resolveMaxSpawnDepth({ configFile: 7 }, (e) => audits.push(e));
    const original = audits[0]!;
    expect(verifySpawnDepthAudit(original)).toBe(true);
    // Tamper with the value but keep the MAC unchanged.
    const tampered: SpawnDepthOverrideAudit = { ...original, overriddenValue: 16 };
    expect(verifySpawnDepthAudit(tampered)).toBe(false);
  });
});

describe('Plan54 §8 — global quota env override', () => {
  let envSnapshot: string | undefined;
  beforeEach(() => {
    envSnapshot = process.env.OPENSTARRY_MAX_ACTIVE_SUBAGENTS_GLOBAL;
    delete process.env.OPENSTARRY_MAX_ACTIVE_SUBAGENTS_GLOBAL;
  });
  afterEach(() => {
    if (envSnapshot !== undefined) process.env.OPENSTARRY_MAX_ACTIVE_SUBAGENTS_GLOBAL = envSnapshot;
    else delete process.env.OPENSTARRY_MAX_ACTIVE_SUBAGENTS_GLOBAL;
  });

  it('returns 64 default when env unset', () => {
    expect(resolveMaxActiveSubagentsGlobal()).toBe(64);
  });

  it('respects in-range env override', () => {
    process.env.OPENSTARRY_MAX_ACTIVE_SUBAGENTS_GLOBAL = '128';
    expect(resolveMaxActiveSubagentsGlobal()).toBe(128);
  });

  it('out-of-range falls back to default', () => {
    process.env.OPENSTARRY_MAX_ACTIVE_SUBAGENTS_GLOBAL = '0';
    expect(resolveMaxActiveSubagentsGlobal()).toBe(64);
    process.env.OPENSTARRY_MAX_ACTIVE_SUBAGENTS_GLOBAL = '2000';
    expect(resolveMaxActiveSubagentsGlobal()).toBe(64);
  });
});
