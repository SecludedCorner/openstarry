/**
 * Core message types for agent communication.
 */

export type MessageRole = "user" | "assistant" | "system" | "tool";

/** A request from the LLM to invoke a tool. */
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** The result of a tool invocation. */
export interface ToolCallResult {
  toolCallId: string;
  name: string;
  result: string;
  isError?: boolean;
}

/** A segment of content within a message. */
export type ContentSegment =
  | { type: "text"; text: string }
  | { type: "tool_call"; toolCall: ToolCallRequest }
  | { type: "tool_result"; toolResult: ToolCallResult }
  | { type: "reasoning"; text: string };

/** A single message in the conversation. */
export interface Message {
  id: string;
  role: MessageRole;
  content: ContentSegment[];
  createdAt: number;
}

/** A streaming event from a provider. */
export type ProviderStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call_start"; toolCallId: string; name: string }
  | { type: "tool_call_delta"; toolCallId: string; input: string }
  | { type: "tool_call_end"; toolCallId: string; name: string; input: string }
  | { type: "finish"; stopReason: "end_turn" | "tool_use" | "max_tokens" | "error"; usage?: TokenUsage }
  | { type: "error"; error: Error };

/** Token usage information from a provider response. */
export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}
