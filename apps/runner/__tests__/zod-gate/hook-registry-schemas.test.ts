/**
 * Plan51 Module 4 — hook-registry Zod gate tests.
 *
 * D-§5-E: 1 module + 2 schema artefacts (Registry + Strategy patterns).
 * STRICT-from-start at registration; AUDITED at dispatch.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  HOOK_TYPES,
  HookRegistration,
  HookRegistry,
  hookContract,
} from '../../src/zod-gate/hook-registry-schemas.js';

const validRegistration = {
  plugin_name: 'transport-http',
  hook_type: 'onCheckpoint' as const,
  plugin_version: '0.1.0-alpha',
  contract_version: 1,
  registered_at: 1_700_000_000,
};

describe('Plan51 §4.4 — hook-registry Zod gate', () => {
  it('HOOK_TYPES enumerates 6 lifecycle phases', () => {
    expect(HOOK_TYPES.length).toBe(6);
    expect([...HOOK_TYPES]).toContain('onCheckpoint');
    expect([...HOOK_TYPES]).toContain('onSchemaDrift');
  });

  describe('Registry pattern — HookRegistration (STRICT from start)', () => {
    it('accepts a valid registration', () => {
      expect(HookRegistration.safeParse(validRegistration).success).toBe(true);
    });

    it('rejects missing plugin_name (STRICT)', () => {
      const { plugin_name: _, ...rest } = validRegistration;
      expect(HookRegistration.safeParse(rest).success).toBe(false);
    });

    it('rejects unknown hook_type (closed enum)', () => {
      expect(HookRegistration.safeParse({
        ...validRegistration,
        hook_type: 'onMagical',
      }).success).toBe(false);
    });

    it('rejects unsupported contract_version (only literal 1)', () => {
      expect(HookRegistration.safeParse({
        ...validRegistration,
        contract_version: 2,
      }).success).toBe(false);
    });
  });

  describe('Strategy pattern — hookContract<I, O>', () => {
    it('parseInput uses Plan49 audited dispatcher (returns SchemaDriftResult)', () => {
      const c = hookContract(z.object({ id: z.string() }), z.boolean());
      const ok = c.parseInput({ id: 'x' }, 'demo');
      expect(ok.ok).toBe(true);
      const fail = c.parseInput({ id: 42 }, 'demo');
      expect(fail.ok).toBe(false);
    });

    it('assertOutput throws on output mismatch', () => {
      const c = hookContract(z.string(), z.number());
      expect(() => c.assertOutput('not-a-number', 'demo')).toThrow(/hook-registry\.demo\.output/);
    });

    it('assertOutput returns parsed output on success', () => {
      const c = hookContract(z.string(), z.number().int());
      expect(c.assertOutput(42, 'demo')).toBe(42);
    });
  });

  describe('HookRegistry (Registry data structure)', () => {
    it('register/lookup/list/reset', () => {
      const r = new HookRegistry();
      r.register(validRegistration);
      expect(r.lookup('transport-http', 'onCheckpoint')).toMatchObject(validRegistration);
      expect(r.list()).toHaveLength(1);
      r.reset();
      expect(r.list()).toHaveLength(0);
    });

    it('register throws on malformed registration (STRICT)', () => {
      const r = new HookRegistry();
      expect(() => r.register({ plugin_name: 'x' } as never)).toThrow();
    });

    it('lookup returns null for unregistered hook', () => {
      const r = new HookRegistry();
      expect(r.lookup('nonexistent', 'onCheckpoint')).toBeNull();
    });
  });
});
