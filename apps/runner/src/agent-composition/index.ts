/**
 * agent-composition — Plan54 AC-9 Sub-Agent Composition Plugin (cycle 03-17 v0.52.0-alpha).
 *
 * Phase 6 第二棒 — full-plugin Plan52 isomorph; ε-surface delta vs Plan52 = 0.
 *
 * @see openstarry_doc/Technical_Specifications/Plan54_AC9_Binding.md
 */

export {
  MAX_SPAWN_DEPTH_DEFAULT,
  MAX_ACTIVE_SUBAGENTS_GLOBAL_DEFAULT,
  MAX_ACTIVE_SUBAGENTS_PER_PARENT,
  ORPHAN_GRACE_WINDOW_MS,
  DEFAULT_LLM_TOKEN_BUDGET_PER_SPAWN,
  resolveMaxSpawnDepth,
  resolveMaxActiveSubagentsGlobal,
  verifySpawnDepthAudit,
  type MaxSpawnDepthConfig,
  type SpawnDepthOverrideAudit,
  type SpawnDepthAuditSink,
  type OverrideSource,
} from './config.js';

export {
  isDepthAdmissible,
  isCapabilityContained,
  walkLineage,
  type LineageNode,
} from './boundary.js';

export {
  LifecycleManager,
} from './lifecycle.js';

export {
  QuotaTracker,
  type QuotaDecision,
} from './quota.js';

export {
  createAgentComposer,
  type AgentComposer,
  type AgentComposerConfig,
} from './spawn.js';
