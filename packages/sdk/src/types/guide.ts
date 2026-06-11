/**
 * Guide interface — behavioral framework.
 * @skandha vijnana (識蘊 — 我執框架·行為約束)
 */
import type { IVijnana } from "./aggregates.js";

/** A guide that provides the agent's persona and system instructions. */
export interface IGuide extends IVijnana {
  id: string;
  name: string;
  getSystemPrompt(): string | Promise<string>;
}

/**
 * CognitiveDirective — persistent instruction stored in guide storage.
 * @skandha vijnana (識蘊)
 * @see Plan36a §5.3
 */
export interface CognitiveDirective {
  readonly id: string;
  readonly label: string;
  readonly content: string;
  readonly priority: number;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly source: string;
  readonly tags?: readonly string[];
}

/**
 * IPersistentGuide — guide with persistent cognitive directives.
 *
 * 二諦聲明 (Two Truths Declaration):
 * - 世俗諦: Persistent directives provide cross-session behavioral continuity.
 * - 勝義諦: These directives form the seventh consciousness (manas; 末那識;
 *   manas-vijñāna) layer per 唯識 doctrine (Yogācāra; cf. canonical
 *   OpenStarry mapping guide-character-init = manas / 7th consciousness) —
 *   persistent self-view that conditions but does not determine behavior.
 *   All directives are conventionally designated, not inherently existent.
 *
 * @skandha vijnana (識蘊)
 * @see Plan36a §5
 */
export interface IPersistentGuide extends IGuide {
  addDirective(directive: CognitiveDirective): Promise<void>;
  removeDirective(id: string): Promise<boolean>;
  clearDirectives(): Promise<void>;
  listDirectives(): Promise<CognitiveDirective[]>;
}
