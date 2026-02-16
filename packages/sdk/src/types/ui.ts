/**
 * UI interface — defines how the agent presents itself (色蘊).
 */
import type { AgentEvent } from "./events.js";

/** A UI renderer that receives agent events and presents output. */
export interface IUI {
  id: string;
  name: string;
  onEvent(event: AgentEvent): void | Promise<void>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}
