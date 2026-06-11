/**
 * Plan51 Module 3 — event-bus Zod gate tests.
 *
 * Includes the F-§5-R2-11 reflexive-case fixture: the
 * `event_bus_schema_violation` event itself MUST validate cleanly under
 * strict mode (does not get suppressed by the gate it triggers).
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EventBusSchemaRegistry,
  EventBusSchemaViolationPayload,
  SIGMA_REGIME_ENUM,
  SigmaEmissionEnvelope,
  SigmaEmissionPayload,
  createDefaultEventBusRegistry,
  eventEnvelope,
} from '../../src/zod-gate/event-bus-schemas.js';

describe('Plan51 §4.3 — event-bus Zod gate', () => {
  it('SIGMA_REGIME_ENUM matches Plan50 closed enum (composition_index/llm_variance/mixed)', () => {
    expect(SIGMA_REGIME_ENUM.options).toEqual(['composition_index', 'llm_variance', 'mixed']);
  });

  it('SigmaEmissionPayload accepts a Plan50-conformant emission', () => {
    const valid = {
      round_id: 'R15',
      sigma: 0.023753,
      sigma_regime: 'composition_index' as const,
    };
    expect(SigmaEmissionPayload.safeParse(valid).success).toBe(true);
  });

  it('SigmaEmissionPayload rejects missing sigma_regime (CV-§5-05 invariant)', () => {
    const invalid = { round_id: 'R15', sigma: 0.05 };
    expect(SigmaEmissionPayload.safeParse(invalid).success).toBe(false);
  });

  it('SigmaEmissionPayload rejects invalid regime values', () => {
    const invalid = { round_id: 'R1', sigma: 0.05, sigma_regime: 'unknown' };
    expect(SigmaEmissionPayload.safeParse(invalid).success).toBe(false);
  });

  it('eventEnvelope wraps a payload schema with type+timestamp', () => {
    const env = eventEnvelope(z.object({ x: z.number() }));
    expect(env.safeParse({
      type: 'demo',
      timestamp: 1,
      payload: { x: 42 },
    }).success).toBe(true);
  });

  it('SigmaEmissionEnvelope round-trips a Plan50 σ-emission event', () => {
    const ok = SigmaEmissionEnvelope.safeParse({
      type: 'audit:sigma_emission',
      timestamp: 1_700_000_000_000,
      payload: { round_id: 'R10', sigma: 0.023753, sigma_regime: 'composition_index' },
    });
    expect(ok.success).toBe(true);
  });

  describe('EventBusSchemaRegistry', () => {
    it('register/lookup/validate happy path', () => {
      const reg = new EventBusSchemaRegistry();
      reg.register('demo', z.object({ k: z.string() }));
      expect(reg.lookup('demo')).not.toBeNull();
      const r = reg.validate('demo', { k: 'v' });
      expect(r.ok).toBe(true);
    });

    it('rejects malformed payload via Plan49 dispatcher (audited mode default)', () => {
      const reg = new EventBusSchemaRegistry();
      reg.register('strict-evt', z.object({ n: z.number() }));
      const r = reg.validate('strict-evt', { n: 'not-a-number' });
      expect(r.ok).toBe(false);
    });

    it('unregistered type is tolerant by design (Plan51 only validates registered)', () => {
      const reg = new EventBusSchemaRegistry();
      const r = reg.validate('unknown-type', { anything: 1 });
      expect(r.ok).toBe(true);
    });

    it('default registry seeds Plan50 σ-emission + reflexive violation schemas', () => {
      const reg = createDefaultEventBusRegistry();
      expect(reg.lookup('audit:sigma_emission')).not.toBeNull();
      expect(reg.lookup('event_bus_schema_violation')).not.toBeNull();
      expect(reg.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Reflexive-case (F-§5-R2-11): event_bus_schema_violation validates under strict', () => {
    it('a malformed-event-triggered violation event itself parses cleanly', () => {
      const reg = createDefaultEventBusRegistry();
      // 1. A genuinely malformed σ-emission event triggers a violation.
      const failed = reg.validate('audit:sigma_emission', { round_id: 'R1', sigma: 'NaN' });
      expect(failed.ok).toBe(false);

      // 2. The plugin (or schema-drift sink) emits a violation event with
      //    Plan51-conformant shape. That violation event MUST itself validate.
      const violation = {
        source_type: 'audit:sigma_emission',
        zod_issues: failed.ok === false ? failed.error : '',
        context: 'reflexive-case-test',
      };
      const reflexive = EventBusSchemaViolationPayload.safeParse(violation);
      expect(reflexive.success).toBe(true);

      // 3. Strict-mode round-trip via registry: violation event lookups
      //    its own schema and validates without triggering a second violation.
      const second = reg.validate('event_bus_schema_violation', violation);
      expect(second.ok).toBe(true);
    });
  });
});
