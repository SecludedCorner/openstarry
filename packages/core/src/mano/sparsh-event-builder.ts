/**
 * SparshEvent construction helper — builds frozen SparshEvent from InputEvent.
 *
 * @skandha cross-cutting (觸 spans all aggregates)
 * @see Plan27b: P27-P SparshEvent construction
 */

import type { SparshEvent, InputEvent } from "@openstarry/sdk";

/**
 * Create a frozen SparshEvent from an InputEvent.
 * Sparsha (觸) = the meeting of sense faculty, object, and consciousness.
 */
export function createSparshEvent(inputEvent: InputEvent): SparshEvent {
  return Object.freeze({
    root: inputEvent.source ?? "mano",
    object: inputEvent.data,
    consciousness: "mano-vijnana",
    timestamp: Date.now(),
  });
}
