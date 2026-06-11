/**
 * multi-ivolition — Plan56 D-30-4 Multi-IVolition Plugin (cycle 03-18 v0.53.0-alpha).
 *
 * Phase 6 第三棒 — Option A single-stream multi-volition queue (SICP queue-as-stream).
 * Plan52/Plan54 isomorph; ε-surface delta vs Plan52 baseline = 0 fields, 0 const.
 *
 * @see research record/cycle03-18/deliver/O1_D30_4_Plan56_implementation_final.md
 */

export {
  MAX_VOLITION_QUEUE_DEFAULT,
  resolveMaxVolitionQueue,
  verifyVolitionQueueAudit,
  type VolitionQueueOverrideAudit,
  type VolitionQueueAuditSink,
  type VolitionQueueOverrideSource,
} from './config.js';

export {
  redactVolitionPayload,
  isRedactedFormat,
} from './redaction.js';

export {
  VolitionQueue,
} from './queue.js';

export {
  createMultiIVolitionDispatcher,
  type MultiIVolitionDispatcher,
  type MultiIVolitionDispatcherConfig,
} from './dispatch.js';
