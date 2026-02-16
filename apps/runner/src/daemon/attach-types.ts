/**
 * Attach Event Payload Types — Event data sent to attached clients.
 *
 * FROZEN: These interfaces define the RPC event payloads for attach mode.
 */

import type { Message } from "@openstarry/sdk";

/**
 * Output event payload (agent.output).
 * Sent for text/reasoning deltas.
 */
export interface OutputEvent {
  /** Session ID that generated this output */
  sessionId: string;

  /** Text delta (incremental chunk) */
  text: string;

  /** Whether this is reasoning output (true) or normal text (false) */
  isReasoning: boolean;
}

/**
 * Replay event payload (agent.replay).
 * Sent when client attaches to existing session.
 */
export interface ReplayEvent {
  /** Session ID */
  sessionId: string;

  /** Message from conversation history */
  message: Message;
}

/**
 * Tool event payload (agent.tool).
 * Sent for tool execution lifecycle.
 */
export interface ToolEvent {
  /** Session ID that executed this tool */
  sessionId: string;

  /** Tool name/ID */
  toolName: string;

  /** Tool execution status */
  status: "started" | "completed" | "failed";

  /** Tool arguments (present for "started") */
  args?: unknown;

  /** Tool result (present for "completed") */
  result?: unknown;

  /** Error message (present for "failed") */
  error?: string;
}

/**
 * Status event payload (agent.status).
 * Sent for general status updates (reserved for future use).
 */
export interface StatusEvent {
  /** Session ID */
  sessionId: string;

  /** Status message */
  message: string;
}

/**
 * Loop event payload (agent.loop).
 * Sent for execution loop phase changes.
 */
export interface LoopEvent {
  /** Session ID */
  sessionId: string;

  /** Loop phase */
  phase: "started" | "awaiting_llm" | "finished" | "error";

  /** Error message (present for "error" phase) */
  error?: string;
}
