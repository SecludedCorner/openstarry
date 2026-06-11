/**
 * IDistributedAlaya — Distributed Alaya-Vijnana Interface
 *
 * ⚠️ Two Truths Declaration (Doc 56 precedent):
 * DistributedAlaya is a samvriti-satya (conventional) designation.
 * Each agent's local seed-store is its own consciousness stream.
 * The "shared" aspect arises through explicit propagation,
 * not through ontological unity.
 *
 * FROZEN: Once published, this interface is FROZEN.
 * Changes require a new Spec Addendum through the Coordinator.
 *
 * Plan38 C14 (D4-R2).
 */

// Import Skandha type from the existing aggregates.ts
import type { Skandha } from "./aggregates.js";

export type SeedScope = 'local' | 'shared' | 'broadcast';
export type SeedVisibility = 'private' | 'group' | 'public';
export type SeedCallback = (event: SeedPropagationEvent) => void;
export type Unsubscribe = () => void;

export interface ISeed {
  seedId: string;
  agentId: string;
  skandha: Skandha;
  content: unknown;
  visibility: SeedVisibility;
  createdAt: number;
  updatedAt: number;
  signature?: string; // Prepared for HMAC-SHA256 per Rule #30
}

export interface SeedFilter {
  agentId?: string;
  skandha?: Skandha;
  visibility?: SeedVisibility;
  since?: number;
}

export interface SeedPropagationEvent {
  seedId: string;
  fromAgentId: string;
  toAgentIds: string[];
  authorization: string; // For future capability-gated propagation
  timestamp: number;
}

/**
 * ExchangeResult — outcome of a bidirectional seed exchange.
 * Renamed from SyncResult (D5-Q1): "sync" implied full state merge,
 * "exchange" correctly reflects selective propagation semantics.
 *
 * FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * @since v0.39.0-alpha
 */
export interface ExchangeResult {
  seedsExchanged: number;
  conflictsResolved: number;
  peerId: string;
  timestamp: number;
}

/**
 * SeedPatch — allowlist type for IDistributedAlaya.update().
 *
 * Uses Pick (allowlist) instead of Omit (denylist). New ISeed fields
 * are immutable by default — only explicitly listed fields are mutable.
 * Security best practice: allowlist > denylist (Plan41 W0, D4-Q4).
 *
 * FROZEN: Architecture_Spec Plan41, Cycle 20260407_cycle03-5.
 * @since v0.41.0-alpha (changed from Omit to Pick)
 */
export type SeedPatch = Pick<Partial<ISeed>, 'content' | 'visibility' | 'updatedAt' | 'signature'>;

/**
 * VectorClock — logical clock for distributed seed ordering.
 * Each agent maintains its own counter; exchangeSeeds merges clocks
 * using element-wise maximum (standard vector clock merge).
 *
 * Implementation note: keys are agentIds, values are monotonically
 * increasing counters. Counter never decreases.
 *
 * FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * @since v0.39.0-alpha
 */
export type VectorClock = Readonly<Record<string, number>>;

/**
 * IBijaStore — local seed store for a single agent's alaya stream.
 *
 * Each agent instance owns exactly one IBijaStore. Seeds planted here
 * are the agent's own "seeds of consciousness" (bija = Sanskrit for seed).
 * Propagation is always explicit — never automatic (Sunyata safeguard).
 *
 * HMAC-SHA256 signature verification is performed by verify()
 * before accepting any inbound seed from propagation.
 *
 * FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * @since v0.39.0-alpha
 */
export interface IBijaStore {
  /** Plant a new seed. Verifies agentId === owning agent (F-8). */
  plant(seed: ISeed): Promise<void>;
  /** Query seeds matching filter. Returns copies, never references. */
  query(filter: SeedFilter): Promise<ISeed[]>;
  /** Update mutable fields only (SeedPatch enforces immutable field exclusion). */
  update(seedId: string, patch: SeedPatch): Promise<void>;
  /** Remove a seed from local store only (does NOT remove propagated copies). */
  remove(seedId: string): Promise<void>;
  /** Get current vector clock for this agent's stream. */
  getVectorClock(): VectorClock;
  /** Merge incoming vector clock (after exchangeSeeds). */
  mergeVectorClock(incoming: VectorClock): void;
  /** Count of seeds in local store. */
  size(): number;
}

/**
 * ISeedSignatureService — HMAC-SHA256 seed integrity service.
 *
 * Used by the AC-7 runtime to sign seeds at plant() time and verify
 * signatures at propagate()/exchangeSeeds() receipt time.
 *
 * Key management: agent-local secret, never transmitted. Signatures
 * are verification tokens, not encryption. A seed with an invalid
 * signature from a remote agent is rejected (fail-closed).
 *
 * FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * @since v0.39.0-alpha
 */
export interface ISeedSignatureService {
  /** Sign a seed's content, returning HMAC-SHA256 hex string. */
  sign(seed: ISeed): Promise<string>;
  /** Verify a seed's signature. Returns false on mismatch (fail-closed). */
  verify(seed: ISeed): Promise<boolean>;
}

/**
 * SeedPropagationRequest — parameters for an outbound propagation.
 * Used internally by the AC-7 runtime; not exposed at IDistributedAlaya level.
 *
 * FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * @since v0.39.0-alpha
 */
export interface SeedPropagationRequest {
  readonly seedId: string;
  readonly fromAgentId: string;
  readonly toAgentIds: readonly string[];
  readonly seed: ISeed;
  readonly signature: string;
  readonly vectorClock: VectorClock;
  readonly timestamp: number;
}

/**
 * IAlayaSnapshot — causally consistent snapshot for late-joiner initialization.
 * FROZEN: Architecture_Spec Plan41, Cycle 20260407_cycle03-5.
 * @since v0.41.0-alpha (D4-Q6)
 */
export interface IAlayaSnapshot {
  readonly seeds: readonly ISeed[];
  readonly vectorClock: VectorClock;
  readonly timestamp: number;
}

/**
 * IDistributedAlaya — Distributed Alaya-Vijnana Interface.
 *
 * Sunyata safeguards (NAGARJUNA):
 * - propagate() must be explicit, never automatic
 * - query(scope='broadcast') returns copies, never references
 * - remove() on a propagated seed does NOT remove the global copy
 *
 * BABBAGE BCT: Purely additive (N=0 consumers). BCT trivially satisfied.
 */
export interface IDistributedAlaya {
  plant(seed: ISeed): Promise<void>;
  query(filter: SeedFilter, scope?: SeedScope): Promise<ISeed[]>;
  update(seedId: string, patch: SeedPatch): Promise<void>;
  remove(seedId: string): Promise<void>;
  propagate(seedId: string, targets: string[]): Promise<void>;
  subscribe(filter: SeedFilter, callback: SeedCallback): Unsubscribe;
  exchangeSeeds(peerId: string): Promise<ExchangeResult>;
  /** Late-joiner snapshot — returns a causally consistent snapshot (Plan41 W4, D4-Q6). */
  snapshot(): Promise<IAlayaSnapshot>;
  /** Restore a snapshot into this alaya instance (MESH G1-G6). */
  restoreSnapshot(snap: IAlayaSnapshot, signatureService: ISeedSignatureService, freshnessThresholdMs?: number): Promise<void>;
}
