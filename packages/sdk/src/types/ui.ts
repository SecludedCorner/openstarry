/**
 * UI interface — output rendering.
 * @skandha rupa (色蘊 — 顯相·輸出)
 */
import type { AgentEvent } from "./events.js";
import type { IRupa } from "./aggregates.js";

/** A UI renderer that receives agent events and presents output. */
export interface IUI extends IRupa {
  id: string;
  name: string;
  onEvent(event: AgentEvent): void | Promise<void>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}
