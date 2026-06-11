/**
 * zod-gate / middleware — Plan51 shared `ZodGateMiddleware` utility.
 *
 * Plan51 R3 D-§5-A 推薦 4-of-5 modules; this is the shared composition
 * substrate consumed by WebSocket / checkpoint-store / event-bus / hook-registry
 * boundary validation hooks.
 *
 * **MR-6 posture**: lives under `apps/runner/src/zod-gate/`, NOT
 * `packages/core/`. Zero Core surface added.
 *
 * **Plan49 integration**: dispatches through `resolveSchemaDriftMode()` so
 * Plan51 inherits the single-process-global mode; per cycle 03-13 D-12
 * UNANIMOUS no per-module fragmentation.
 *
 * **F-16 SHOULD initial**: audit emissions can carry F-16 StructuredError
 * shape; gating remains schema-drift-policy semantics. MR-9 honoured — no
 * preemptive MUST binding.
 *
 * @see openstarry_doc/Technical_Specifications/Plan51_Zod_Gate_Binding.md §6
 */

import type { ZodType } from 'zod';
import {
  applySchemaDriftPolicy,
  type SchemaDriftMode,
  type SchemaDriftResult,
} from '../schema-drift-policy/index.js';

/** Inbound (untrusted) validation — returns SchemaDriftResult per Plan49 dispatcher. */
export function validateInbound<T>(
  schema: ZodType<T>,
  input: unknown,
  context: string,
  overrideMode?: SchemaDriftMode,
): SchemaDriftResult<T> {
  return applySchemaDriftPolicy(schema, input, context, overrideMode);
}

/**
 * Outbound (assertion-style) validation — used when we control the producer.
 * Plan51 spec: WebSocket outbound, checkpoint-store write-path, hook-registry
 * registration-time. Throws on schema mismatch (programmer error, not user
 * input). Returns the parsed value when valid.
 */
export function assertOutbound<T>(
  schema: ZodType<T>,
  value: unknown,
  context: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`zod-gate assertOutbound[${context}]: ${parsed.error.message}`);
  }
  return parsed.data;
}
