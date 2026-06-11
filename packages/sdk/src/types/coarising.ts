/**
 * CoarisingBundle — 五遍行 (5 universals, DC-8: reference design).
 *
 * The five universals (sarvatraga) co-arise simultaneously with every
 * moment of consciousness. This is a reference design — field composition
 * may be expanded or adjusted in future cycles.
 *
 * @skandha cross-cutting (觸 spans all aggregates)
 * @see R3 Debate 1+2: Sparsha Coarising Model (Docs 30, 39)
 * @module coarising
 */

import type { ChannelVedana } from "./vedana.js";

/**
 * SparshEvent — 觸 (constitutive contact event).
 * The meeting of sense faculty (indriya), object (visaya),
 * and consciousness (vijnana).
 */
export interface SparshEvent {
  /** Root sense faculty (e.g., "eye", "ear", "mano") */
  readonly root: string;
  /** External stimulus object */
  readonly object: unknown;
  /** Cognitive domain identifier */
  readonly consciousness: string;
  /** Event timestamp (epoch ms, optional for backward compat) */
  readonly timestamp?: number;
}

/**
 * ChannelSamjna — 想 (perception/recognition) channel.
 * The labeling function that identifies "what" something is.
 */
export interface ChannelSamjna {
  /** Recognized label/category */
  readonly label: string;
  /** Recognition confidence: [0.0, 1.0] */
  readonly confidence: number;
}

/**
 * ChannelCetana — 思 (intention/volition) channel.
 * The directional impulse that drives action.
 */
export interface ChannelCetana {
  /** Intention descriptor */
  readonly intention: string;
  /** Urgency level: [0.0 (no rush), 1.0 (critical)] */
  readonly urgency: number;
}

/**
 * ChannelManasikara — 作意 (attention/advertence) channel.
 * The focusing mechanism that directs consciousness.
 */
export interface ChannelManasikara {
  /** Current focus target (vijnana-clock snapshot from IGuide) */
  readonly focus: string;
  /** Attention intensity: 0.0=peripheral, 1.0=focal */
  readonly intensity: number;
}

/**
 * ManasikaraDimension — extended attention dimensions (Plan27).
 * Adds selectivity and persistence to the base focus/intensity model.
 */
export interface ManasikaraDimension {
  /** Current focus target */
  readonly focus: string;
  /** Attention intensity: 0.0=peripheral, 1.0=focal */
  readonly intensity: number;
  /** Selectivity: 0.0=broad, 1.0=narrow (how much irrelevant info is filtered) */
  readonly selectivity: number;
  /** Persistence in ms: how long attention has been sustained on this focus */
  readonly persistenceMs: number;
}

/**
 * Convert a ChannelManasikara to a ManasikaraDimension.
 * Defaults: selectivity=0.5, persistenceMs=0.
 */
export function fromChannelManasikara(manasikara: ChannelManasikara): ManasikaraDimension {
  return {
    focus: manasikara.focus,
    intensity: manasikara.intensity,
    selectivity: 0.5,
    persistenceMs: 0,
  };
}

/**
 * SahajaContract — quality guarantee for CoarisingBundle.
 * Ensures the five universals are consistent and fresh.
 */
export interface SahajaContract {
  /** All components mutually reference each other */
  readonly mutualConsistency: boolean;
  /** Externals cannot see a partial bundle */
  readonly atomicPublication: boolean;
  /** Max time skew (ms) between oldest and newest component */
  readonly stalenessUpperBound: number;
}

/**
 * CoarisingBundle — the five universals (sarvatraga) that co-arise
 * with every moment of consciousness.
 *
 * DC-8: This is a reference design. Field composition may be
 * expanded or adjusted in future cycles per Master's guidance.
 */
export interface CoarisingBundle {
  /** Sparsha (觸) — contact event */
  readonly sparsha: SparshEvent;
  /** Vedana (受) — feeling tone */
  readonly vedana: ChannelVedana;
  /** Samjna (想) — perception/recognition */
  readonly samjna: ChannelSamjna;
  /** Cetana (思) — intention/volition */
  readonly cetana: ChannelCetana;
  /** Manasikara (作意) — attention/advertence */
  readonly manasikara: ChannelManasikara;
  /** Layer 1 (root gate) or Layer 2 (mano aggregation) */
  readonly layer: 1 | 2;
  /** Processing mode */
  readonly mode: 'fast' | 'slow';
  /** Quality guarantee */
  readonly sahaja: SahajaContract;
  /** Bundle creation timestamp */
  readonly timestamp: number;
}

/**
 * Default SahajaContract staleness bound in ms.
 * Plan32 Wave 4 (P1): canonical source for coarising quality check.
 */
export const DEFAULT_STALENESS_BOUND_MS = 50;
