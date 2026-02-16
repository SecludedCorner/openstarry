/**
 * Event Forwarder — Bridge core.bus events to IPC clients via RPC events.
 *
 * Subscribes to core event bus with wildcard listener and maps AgentEventType
 * to RPC events for attached clients.
 */

import type { EventBus, AgentEvent } from "@openstarry/sdk";
import { AgentEventType } from "@openstarry/sdk";
import type { IPCServer, RPCEvent } from "./types.js";
import type { IPCServerImpl } from "./ipc-server.js";
import type { OutputEvent, ToolEvent, LoopEvent } from "./attach-types.js";

/**
 * Initialize event forwarder.
 *
 * Subscribes to all events on the core bus and forwards relevant events
 * to attached IPC clients based on sessionId.
 *
 * @param bus - Core event bus
 * @param ipcServer - IPC server instance
 * @param agentId - Agent ID for logging
 * @returns Unsubscribe function
 */
export function initEventForwarder(
  bus: EventBus,
  ipcServer: IPCServerImpl,
  agentId: string,
): () => void {
  // Subscribe to all events with wildcard listener
  return bus.onAny((event: AgentEvent) => {
    // Extract sessionId from event metadata
    const sessionId = extractSessionId(event);
    if (!sessionId) {
      // Events without sessionId are not forwarded
      return;
    }

    // Map AgentEventType to RPC events
    const rpcEvent = mapEventToRPC(event, sessionId);
    if (!rpcEvent) {
      // Event type not relevant for attach clients
      return;
    }

    // Broadcast to session subscribers
    ipcServer.broadcastToSession(sessionId, rpcEvent);
  });
}

/**
 * Extract sessionId from event metadata.
 *
 * Events must have metadata.sessionId to be forwarded.
 */
function extractSessionId(event: AgentEvent): string | null {
  if (
    event.payload &&
    typeof event.payload === "object" &&
    "metadata" in event.payload &&
    event.payload.metadata &&
    typeof event.payload.metadata === "object" &&
    "sessionId" in event.payload.metadata &&
    typeof event.payload.metadata.sessionId === "string"
  ) {
    return event.payload.metadata.sessionId;
  }

  // Fallback: check top-level sessionId in payload (backward compat with direct session events)
  if (
    event.payload &&
    typeof event.payload === "object" &&
    "sessionId" in event.payload &&
    typeof event.payload.sessionId === "string"
  ) {
    return event.payload.sessionId;
  }

  return null;
}

/**
 * Map AgentEventType to RPC event.
 *
 * Returns null if event type is not relevant for attach clients.
 */
function mapEventToRPC(event: AgentEvent, sessionId: string): RPCEvent | null {
  switch (event.type) {
    case AgentEventType.STREAM_TEXT_DELTA: {
      const payload = event.payload as { text?: string };
      const outputEvent: OutputEvent = {
        sessionId,
        text: payload.text ?? "",
        isReasoning: false,
      };
      return { event: "agent.output", data: outputEvent };
    }

    case AgentEventType.STREAM_REASONING_DELTA: {
      const payload = event.payload as { text?: string };
      const outputEvent: OutputEvent = {
        sessionId,
        text: payload.text ?? "",
        isReasoning: true,
      };
      return { event: "agent.output", data: outputEvent };
    }

    case AgentEventType.TOOL_EXECUTING: {
      const payload = event.payload as { name?: string; arguments?: unknown };
      const toolEvent: ToolEvent = {
        sessionId,
        toolName: payload.name ?? "unknown",
        status: "started",
        args: payload.arguments,
      };
      return { event: "agent.tool", data: toolEvent };
    }

    case AgentEventType.TOOL_RESULT: {
      const payload = event.payload as { name?: string; result?: unknown };
      const toolEvent: ToolEvent = {
        sessionId,
        toolName: payload.name ?? "unknown",
        status: "completed",
        result: payload.result,
      };
      return { event: "agent.tool", data: toolEvent };
    }

    case AgentEventType.TOOL_ERROR: {
      const payload = event.payload as { name?: string; error?: string };
      const toolEvent: ToolEvent = {
        sessionId,
        toolName: payload.name ?? "unknown",
        status: "failed",
        error: payload.error ?? "Unknown error",
      };
      return { event: "agent.tool", data: toolEvent };
    }

    case AgentEventType.LOOP_STARTED: {
      const loopEvent: LoopEvent = {
        sessionId,
        phase: "started",
      };
      return { event: "agent.loop", data: loopEvent };
    }

    case AgentEventType.LOOP_AWAITING_LLM: {
      const loopEvent: LoopEvent = {
        sessionId,
        phase: "awaiting_llm",
      };
      return { event: "agent.loop", data: loopEvent };
    }

    case AgentEventType.LOOP_FINISHED: {
      const loopEvent: LoopEvent = {
        sessionId,
        phase: "finished",
      };
      return { event: "agent.loop", data: loopEvent };
    }

    case AgentEventType.LOOP_ERROR: {
      const payload = event.payload as { error?: string };
      const loopEvent: LoopEvent = {
        sessionId,
        phase: "error",
        error: payload.error ?? "Unknown error",
      };
      return { event: "agent.loop", data: loopEvent };
    }

    case AgentEventType.MESSAGE_SYSTEM: {
      const payload = event.payload as { text?: string };
      const outputEvent: OutputEvent = {
        sessionId,
        text: (payload.text ?? "") + "\n",
        isReasoning: false,
      };
      return { event: "agent.output", data: outputEvent };
    }

    default:
      // Event type not relevant for attach clients
      return null;
  }
}
