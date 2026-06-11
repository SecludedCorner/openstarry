/**
 * zod-gate — Plan51 4-of-5 modules + shared utility public surface.
 *
 * Plan51 R3 D-§5-A 推薦 modules:
 *   - WebSocket Zod gate     (lives in `openstarry_plugin/transport-websocket/src/zod-gate.ts`)
 *   - checkpoint-store       (this package: `./checkpoint-schemas.ts`)
 *   - event-bus              (this package: `./event-bus-schemas.ts`)
 *   - hook-registry          (this package: `./hook-registry-schemas.ts`)
 *
 * plugin-loader DEFERRED cycle 03-17+ post-AC-9 per D-§5-A 9/11/3 (no super-majority).
 *
 * @see openstarry_doc/Technical_Specifications/Plan51_Zod_Gate_Binding.md
 */

export { validateInbound, assertOutbound } from './middleware.js';
export {
  CheckpointSchema,
  CHECKPOINT_SCHEMA_VERSIONS,
  type CheckpointSchemaVersion,
  type CheckpointV050Type,
  type CheckpointAuditEvent,
  type CheckpointAuditSink,
  readCheckpoint,
  writeCheckpoint,
} from './checkpoint-schemas.js';
export {
  SIGMA_REGIME_ENUM,
  eventEnvelope,
  EventBusSchemaViolationPayload,
  EventBusSchemaViolationEnvelope,
  SigmaEmissionPayload,
  SigmaEmissionEnvelope,
  EventBusSchemaRegistry,
  createDefaultEventBusRegistry,
} from './event-bus-schemas.js';
export {
  HOOK_TYPES,
  type HookType,
  HookRegistration,
  type HookRegistrationType,
  hookContract,
  HookRegistry,
} from './hook-registry-schemas.js';
