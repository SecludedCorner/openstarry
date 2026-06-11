/**
 * Listener interface — sensory input channels.
 * @skandha rupa (色蘊 — 感官根·輸入)
 */
import type { IRupa } from "./aggregates.js";

/** A listener that receives external input (e.g., CLI stdin, WebSocket, HTTP). */
export interface IListener extends IRupa {
  id: string;
  name: string;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}

/**
 * Sense type discriminant for typed listeners (AC-6, Plan37 C9).
 * Sanskrit terms per Buddhist epistemology:
 * - caksur (眼) = visual
 * - srotra (耳) = auditory
 * - ghana (鼻) = olfactory
 * - jihva (舌) = gustatory
 * - kaya (身) = tactile
 * - mano (意) = mental/integrative (sixth consciousness)
 */
export type SenseType = 'caksur' | 'srotra' | 'ghana' | 'jihva' | 'kaya' | 'mano';

/**
 * Typed listener with sense-type discriminant.
 * Extends IListener with a readonly senseType field.
 * BABBAGE BCT: Existing IListener implementations continue to work unmodified.
 */
export interface ITypedListener extends IListener {
  readonly senseType: SenseType;
}

/** Five concrete sub-interfaces for the front-five senses. */
export interface IVisualListener extends ITypedListener { readonly senseType: 'caksur'; }
export interface IAuditoryListener extends ITypedListener { readonly senseType: 'srotra'; }
export interface IOlfactoryListener extends ITypedListener { readonly senseType: 'ghana'; }
export interface IGustatoryListener extends ITypedListener { readonly senseType: 'jihva'; }
export interface ITactileListener extends ITypedListener { readonly senseType: 'kaya'; }

/** Backward-compatible union: accepts both typed and untyped listeners. */
export type AnyListener = ITypedListener | IListener;
