/**
 * MockProvider — Deterministic LLM provider for E2E testing.
 * Generates predictable responses without making real API calls.
 */

import type {
  IProvider,
  ChatRequest,
  ProviderStreamEvent,
  ModelInfo,
} from "@openstarry/sdk";

export class MockProvider implements IProvider {
  id = "mock-provider";
  name = "Mock Provider (E2E)";
  models: ModelInfo[] = [
    { id: "mock-model", name: "Mock Model" },
  ];

  private responses: string[] = [];
  private toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  private callHistory: ChatRequest[] = [];

  setNextResponse(text: string): void {
    this.responses.push(text);
  }

  setNextToolCall(toolName: string, args: Record<string, unknown>): void {
    this.toolCalls.push({ name: toolName, args });
  }

  async *chat(request: ChatRequest): AsyncIterable<ProviderStreamEvent> {
    this.callHistory.push(request);

    // Yield tool call if queued
    if (this.toolCalls.length > 0) {
      const toolCall = this.toolCalls.shift()!;
      const toolCallId = `mock-${Date.now()}`;

      yield {
        type: "tool_call_start",
        toolCallId,
        name: toolCall.name,
      };

      yield {
        type: "tool_call_delta",
        toolCallId,
        input: JSON.stringify(toolCall.args),
      };

      yield {
        type: "tool_call_end",
        toolCallId,
        name: toolCall.name,
        input: JSON.stringify(toolCall.args),
      };

      yield {
        type: "finish",
        stopReason: "tool_use",
      };
      return;
    }

    // Yield text response if queued
    if (this.responses.length > 0) {
      const text = this.responses.shift()!;
      yield { type: "text_delta", text };
      yield { type: "finish", stopReason: "end_turn" };
      return;
    }

    // Default response
    yield { type: "text_delta", text: "Mock response" };
    yield { type: "finish", stopReason: "end_turn" };
  }

  getCallHistory(): ChatRequest[] {
    return [...this.callHistory];
  }

  reset(): void {
    this.responses = [];
    this.toolCalls = [];
    this.callHistory = [];
  }
}
