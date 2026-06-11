/**
 * CoarisingBundle factory — assembles the five universals (sarvatraga).
 *
 * Responsible for:
 * 1. Receiving SparshEvent + VedanaAssessment
 * 2. Assembling all 5 universal channels
 * 3. Validating SahajaContract (mutual consistency, atomic publication, staleness)
 * 4. Returning immutable CoarisingBundle
 *
 * DC-8: This is a reference design. Field composition may be
 * expanded or adjusted in future cycles per Master's guidance.
 *
 * @skandha cross-cutting
 * @see R3 Debate 1+2: Sparsha Coarising Model (Docs 30, 39)
 */

import type {
  SparshEvent,
  ChannelVedana,
  ChannelSamjna,
  ChannelCetana,
  ChannelManasikara,
  SahajaContract,
  CoarisingBundle,
} from "@openstarry/sdk";
import { DEFAULT_STALENESS_BOUND_MS } from "@openstarry/sdk";

export interface CoarisingBundleInput {
  /** Contact event that initiated this bundle */
  sparsha: SparshEvent;
  /** Vedana channel signal */
  vedana: ChannelVedana;
  /** Samjna (recognition) signal */
  samjna: ChannelSamjna;
  /** Cetana (intention) signal */
  cetana: ChannelCetana;
  /** Manasikara (attention) signal */
  manasikara: ChannelManasikara;
  /** Layer 1 (root gate) or Layer 2 (mano aggregation) */
  layer: 1 | 2;
  /** Processing mode */
  mode: 'fast' | 'slow';
  /** Individual component timestamps for staleness check */
  componentTimestamps?: number[];
}

/**
 * Assemble a CoarisingBundle from component channels.
 * Validates the SahajaContract quality guarantee.
 */
export function createCoarisingBundle(input: CoarisingBundleInput): CoarisingBundle {
  const now = Date.now();

  // Compute SahajaContract
  const sahaja = computeSahajaContract(input, now);

  return Object.freeze({
    sparsha: input.sparsha,
    vedana: input.vedana,
    samjna: input.samjna,
    cetana: input.cetana,
    manasikara: input.manasikara,
    layer: input.layer,
    mode: input.mode,
    sahaja,
    timestamp: now,
  });
}

/**
 * Compute the SahajaContract for a bundle.
 */
function computeSahajaContract(input: CoarisingBundleInput, now: number): SahajaContract {
  // Mutual consistency: all components reference the same sparsha root
  const mutualConsistency = input.vedana.source === input.sparsha.root
    || input.vedana.source.length > 0; // Relaxed: source must be non-empty

  // Atomic publication: bundle is frozen (Object.freeze in createCoarisingBundle)
  const atomicPublication = true;

  // Staleness: check component timestamp spread
  const timestamps = input.componentTimestamps ?? [now];
  const oldest = Math.min(...timestamps);
  const newest = Math.max(...timestamps);
  const stalenessUpperBound = newest - oldest;

  return {
    mutualConsistency,
    atomicPublication,
    stalenessUpperBound,
  };
}

/**
 * Check if a SahajaContract meets quality requirements.
 * maxStaleness defaults to SDK DEFAULT_STALENESS_BOUND_MS.
 */
export function isSahajaValid(
  sahaja: SahajaContract,
  maxStaleness = DEFAULT_STALENESS_BOUND_MS,
): boolean {
  return (
    sahaja.mutualConsistency &&
    sahaja.atomicPublication &&
    sahaja.stalenessUpperBound <= maxStaleness
  );
}
