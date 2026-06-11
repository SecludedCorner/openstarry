/**
 * zod-gate / event-bus-schemas — Plan51 Module 3 (rollout #3).
 *
 * `EventEnvelope<T>` typed wrapper + `EventBusSchemaRegistry` registry with
 * register/lookup/validate API. Audited-mode default per Plan49 baseline.
 *
 * **Plan50 σ_regime non-interference (CV-§5-05)**: σ-emission events MUST
 * carry `sigma_regime: z.enum(['composition_index', 'llm_variance', 'mixed'])`.
 * Layer-orthogonal: structural validation at envelope; numeric metric tag is
 * a payload field within.
 *
 * **Reflexive-case discipline (F-§5-R2-11)**: emit a malformed event;
 * verify the `event_bus_schema_violation` event itself validates cleanly
 * under strict mode (does not get suppressed by the gate it triggers).
 *
 * @see openstarry_doc/Technical_Specifications/Plan51_Zod_Gate_Binding.md §4.3 + §6.2
 */

import { z, type ZodType } from 'zod';
import { validateInbound } from './middleware.js';

/** Plan50-aligned closed enum on event-bus boundary (CV-§5-05). */
export const SIGMA_REGIME_ENUM = z.enum(['composition_index', 'llm_variance', 'mixed']);

/** Generic `EventEnvelope<T>`: every event-bus event has type + timestamp + payload. */
export function eventEnvelope<T extends ZodType>(payload: T) {
  return z.object({
    type: z.string().min(1),
    timestamp: z.number().int().nonnegative(),
    payload,
  });
}

/** Reflexive: schema for `event_bus_schema_violation` itself (must validate under strict). */
export const EventBusSchemaViolationPayload = z.object({
  source_type: z.string().min(1),
  zod_issues: z.string(),
  context: z.string().min(1),
});
export const EventBusSchemaViolationEnvelope = eventEnvelope(EventBusSchemaViolationPayload);

/** σ-emission payload (Plan50 sigma_regime field MUST be present per CV-§5-05). */
export const SigmaEmissionPayload = z.object({
  round_id: z.string().min(1),
  sigma: z.number().finite(),
  sigma_regime: SIGMA_REGIME_ENUM,
  ucl: z.number().finite().optional(),
  lcl: z.number().finite().optional(),
});
export const SigmaEmissionEnvelope = eventEnvelope(SigmaEmissionPayload);

/** Registry data structure (D-§5-E pattern split: data vs strategy). */
export class EventBusSchemaRegistry {
  private readonly schemas = new Map<string, ZodType<unknown>>();

  /** Register a schema for a given event type. Idempotent overwrite allowed. */
  register<T>(type: string, schema: ZodType<T>): void {
    this.schemas.set(type, schema as ZodType<unknown>);
  }

  /** Lookup a registered schema; returns null if absent. */
  lookup(type: string): ZodType<unknown> | null {
    return this.schemas.get(type) ?? null;
  }

  /**
   * Validate an event payload against its registered schema. Audited-mode
   * default per Plan49 dispatcher. Returns the SchemaDriftResult; caller
   * decides emission shape (Plan49 emits `schema_drift_audit` family).
   */
  validate<T = unknown>(type: string, payload: unknown) {
    const schema = this.lookup(type);
    if (!schema) {
      // Unknown event type: tolerant by design (Plan51 only validates registered types).
      return { ok: true as const, data: payload as T, warnings: 'unregistered-type' };
    }
    return validateInbound<T>(schema as ZodType<T>, payload, `event-bus.${type}`);
  }

  /** Number of registered schemas (observability only). */
  get size(): number {
    return this.schemas.size;
  }
}

/** Default registry seeded with Plan50/Plan51-required schemas. */
export function createDefaultEventBusRegistry(): EventBusSchemaRegistry {
  const reg = new EventBusSchemaRegistry();
  reg.register('audit:sigma_emission', SigmaEmissionPayload);
  reg.register('event_bus_schema_violation', EventBusSchemaViolationPayload);
  return reg;
}
