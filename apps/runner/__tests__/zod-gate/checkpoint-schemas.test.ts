/**
 * Plan51 Module 2 — checkpoint-store Zod gate tests.
 *
 * Cross-version-skew migration matrix per D-§5-G UNANIMOUS:
 *   v0.42 → v0.45 → v0.48 → v0.50 round-trip.
 */

import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT_SCHEMA_VERSIONS,
  type CheckpointAuditEvent,
  readCheckpoint,
  writeCheckpoint,
} from '../../src/zod-gate/checkpoint-schemas.js';

describe('Plan51 §4.2 — checkpoint-store Zod gate', () => {
  it('exposes the 4-version matrix v0.42 / v0.45 / v0.48 / v0.50', () => {
    expect([...CHECKPOINT_SCHEMA_VERSIONS]).toEqual(['v0.42', 'v0.45', 'v0.48', 'v0.50']);
  });

  it('reads a v0.50 checkpoint identity (no migration)', () => {
    const events: CheckpointAuditEvent[] = [];
    const result = readCheckpoint({
      schema_version: 'v0.50',
      agent_id: 'a',
      session_id: 's',
      created_at: 1,
      state: { x: 1 },
    }, (e) => events.push(e));
    expect(result?.schema_version).toBe('v0.50');
    expect(events).toHaveLength(0); // no migration emitted for v0.50
  });

  it('migrates v0.42 (camelCase) → v0.50 (snake_case) and emits migration_applied', () => {
    const events: CheckpointAuditEvent[] = [];
    const result = readCheckpoint({
      schema_version: 'v0.42',
      agentId: 'agent-1',
      sessionId: 'sess-1',
      createdAt: 100,
      state: 'opaque',
    }, (e) => events.push(e));
    expect(result).not.toBeNull();
    expect(result!.schema_version).toBe('v0.50');
    expect(result!.agent_id).toBe('agent-1');
    expect(result!.session_id).toBe('sess-1');
    expect(result!.created_at).toBe(100);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'checkpoint_migration_applied',
      from_version: 'v0.42',
      to_version: 'v0.50',
    });
  });

  it('migrates v0.45 → v0.50 (snake_case identity) and emits migration_applied', () => {
    const events: CheckpointAuditEvent[] = [];
    const result = readCheckpoint({
      schema_version: 'v0.45',
      agent_id: 'a',
      session_id: 's',
      created_at: 1,
      state: null,
    }, (e) => events.push(e));
    expect(result?.schema_version).toBe('v0.50');
    expect(events[0]?.event).toBe('checkpoint_migration_applied');
  });

  it('migrates v0.48 → v0.50 (drops version-only difference) and emits migration_applied', () => {
    const events: CheckpointAuditEvent[] = [];
    const result = readCheckpoint({
      schema_version: 'v0.48',
      agent_id: 'a',
      session_id: 's',
      created_at: 2,
      state: { plan: 48 },
      hmac_envelope: {
        algorithm: 'sha256',
        nonce: 'deadbeef',
        signature: 'cafef00d',
        signed_at: 100,
      },
    }, (e) => events.push(e));
    expect(result?.schema_version).toBe('v0.50');
    expect(result?.hmac_envelope?.algorithm).toBe('sha256');
    expect(events[0]?.event).toBe('checkpoint_migration_applied');
  });

  it('graceful-degradation: malformed checkpoint → null + schema_violation event (never blocks recovery)', () => {
    const events: CheckpointAuditEvent[] = [];
    const result = readCheckpoint({ schema_version: 'v0.99', wat: true }, (e) => events.push(e));
    expect(result).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: 'checkpoint_schema_violation', from_version: null });
  });

  it('graceful-degradation: completely garbage input → null + schema_violation', () => {
    const events: CheckpointAuditEvent[] = [];
    expect(readCheckpoint('not-an-object', (e) => events.push(e))).toBeNull();
    expect(events[0]?.event).toBe('checkpoint_schema_violation');
  });

  it('write-path assertion: rejects non-conforming v0.50 record', () => {
    expect(() => writeCheckpoint({
      schema_version: 'v0.50',
      agent_id: '',
      session_id: 's',
      created_at: 1,
      state: null,
    } as never)).toThrow(/checkpoint-store\.write/);
  });

  it('cross-version round-trip: v0.42 → migrate → v0.50 → write asserts cleanly', () => {
    const v042 = readCheckpoint({
      schema_version: 'v0.42',
      agentId: 'a',
      sessionId: 's',
      createdAt: 1,
      state: { migrated: true },
    });
    expect(v042).not.toBeNull();
    const written = writeCheckpoint(v042!);
    expect(written.agent_id).toBe('a');
    expect(written.schema_version).toBe('v0.50');
  });
});
