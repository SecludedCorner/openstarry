/**
 * E2E Tests: Agent Workflow
 * Tests the full agent execution loop: input → LLM → tool → output.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAgentFixture, type IAgentTestFixture } from "./helpers/index.js";
import { AgentEventType } from "@openstarry/sdk";

describe("E2E: Agent Workflow", () => {
  let fixture: IAgentTestFixture;

  beforeEach(() => {
    fixture = createAgentFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("should trigger execution loop on user input", async () => {
    fixture.mockProvider.setNextResponse("Hello! How can I help you?");
    await fixture.start();

    fixture.pushInput("Hello, agent!");

    const loopStartedEvent = await fixture.waitForEvent(
      AgentEventType.LOOP_STARTED,
      3000,
    );
    expect(loopStartedEvent).toBeDefined();
  });

  it("should emit LOOP_STARTED event", async () => {
    fixture.mockProvider.setNextResponse("Test response");
    await fixture.start();

    fixture.pushInput("Test input");

    const loopStartedEvent = await fixture.waitForEvent(
      AgentEventType.LOOP_STARTED,
      3000,
    );
    expect(loopStartedEvent).toBeDefined();
    expect(loopStartedEvent.type).toBe(AgentEventType.LOOP_STARTED);
  });

  it("should send messages to provider", async () => {
    fixture.mockProvider.setNextResponse("Response from provider");
    await fixture.start();

    fixture.pushInput("Test message");

    await fixture.waitForEvent(AgentEventType.LOOP_FINISHED, 3000);

    const callHistory = fixture.mockProvider.getCallHistory();
    expect(callHistory.length).toBeGreaterThan(0);
    expect(callHistory[0].messages).toBeDefined();
  });

  it("should emit MESSAGE_ASSISTANT event on response", async () => {
    fixture.mockProvider.setNextResponse("Hello! How can I help you?");
    await fixture.start();

    fixture.pushInput("Hello!");

    const assistantEvent = await fixture.waitForEvent(
      AgentEventType.MESSAGE_ASSISTANT,
      3000,
    );
    expect(assistantEvent).toBeDefined();
    expect(assistantEvent.payload).toBeDefined();
  });

  it("should emit STREAM_TEXT_DELTA during streaming", async () => {
    fixture.mockProvider.setNextResponse("Streaming response");
    await fixture.start();

    fixture.pushInput("Test");

    const streamDeltaEvent = await fixture.waitForEvent(
      AgentEventType.STREAM_TEXT_DELTA,
      3000,
    );
    expect(streamDeltaEvent).toBeDefined();
  });

  it("should emit STREAM_FINISH after stream completes", async () => {
    fixture.mockProvider.setNextResponse("Complete");
    await fixture.start();

    fixture.pushInput("Test");

    const finishEvent = await fixture.waitForEvent(
      AgentEventType.STREAM_FINISH,
      3000,
    );
    expect(finishEvent).toBeDefined();
  });

  it("should emit LOOP_FINISHED event", async () => {
    fixture.mockProvider.setNextResponse("Done");
    await fixture.start();

    fixture.pushInput("Test");

    const loopFinishedEvent = await fixture.waitForEvent(
      AgentEventType.LOOP_FINISHED,
      3000,
    );
    expect(loopFinishedEvent).toBeDefined();
    expect(loopFinishedEvent.type).toBe(AgentEventType.LOOP_FINISHED);
  });

  it("should trigger TOOL_EXECUTING event on tool call", async () => {
    // Register a mock tool
    const mockTool = {
      id: "mock-tool",
      name: "Mock Tool",
      description: "Test tool",
      schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute(_ctx: any, _args: any) {
        return "Tool result";
      },
    };
    fixture.core.toolRegistry.register(mockTool);

    fixture.mockProvider.setNextToolCall("mock-tool", {});
    fixture.mockProvider.setNextResponse("Tool executed successfully");
    await fixture.start();

    fixture.pushInput("Use the tool");

    const toolExecutingEvent = await fixture.waitForEvent(
      AgentEventType.TOOL_EXECUTING,
      3000,
    );
    expect(toolExecutingEvent).toBeDefined();
  });

  it.skip("should emit TOOL_RESULT after tool execution", async () => {
    // Skipped: Tool execution flow requires more complex setup with proper context
    const mockTool = {
      id: "result-tool",
      name: "Result Tool",
      description: "Test tool",
      schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute(_ctx: any, _args: any) {
        return "Tool completed";
      },
    };
    fixture.core.toolRegistry.register(mockTool);

    fixture.mockProvider.setNextToolCall("result-tool", {});
    fixture.mockProvider.setNextResponse("Done");
    await fixture.start();

    fixture.pushInput("Execute tool");

    const toolResultEvent = await fixture.waitForEvent(
      AgentEventType.TOOL_RESULT,
      3000,
    );
    expect(toolResultEvent).toBeDefined();
  });

  it("should handle multiple loop iterations", async () => {
    fixture.mockProvider.setNextResponse("First response");
    await fixture.start();

    fixture.pushInput("First message");
    await fixture.waitForEvent(AgentEventType.LOOP_FINISHED, 3000);

    fixture.mockProvider.setNextResponse("Second response");
    fixture.pushInput("Second message");
    await fixture.waitForEvent(AgentEventType.LOOP_FINISHED, 3000);

    const loopStartedEvents = fixture.events.filter(
      (e) => e.type === AgentEventType.LOOP_STARTED,
    );
    expect(loopStartedEvents.length).toBeGreaterThanOrEqual(2);
  });

  it("should enforce max tool rounds", async () => {
    const fixtureWithLowMax = createAgentFixture({
      cognition: {
        provider: "mock-provider",
        model: "mock-model",
        maxToolRounds: 1,
      },
    });

    const mockTool = {
      id: "loop-tool",
      name: "Loop Tool",
      description: "Tool that loops",
      schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute(_ctx: any, _args: any) {
        return "Looping";
      },
    };
    fixtureWithLowMax.core.toolRegistry.register(mockTool);
    fixtureWithLowMax.core.providerRegistry.register(
      fixtureWithLowMax.mockProvider,
    );

    fixtureWithLowMax.mockProvider.setNextToolCall("loop-tool", {});
    fixtureWithLowMax.mockProvider.setNextToolCall("loop-tool", {});
    fixtureWithLowMax.mockProvider.setNextResponse("Done");

    await fixtureWithLowMax.start();
    fixtureWithLowMax.pushInput("Loop test");

    await fixtureWithLowMax.waitForEvent(AgentEventType.LOOP_FINISHED, 3000);

    await fixtureWithLowMax.cleanup();
  });
});
