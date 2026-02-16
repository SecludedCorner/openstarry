/**
 * ExecutionLoop — the agentic cognition loop (event-driven).
 *
 * State machine (per design doc 01_Execution_Loop.md):
 *   WAITING_FOR_EVENT → ASSEMBLING_CONTEXT → AWAITING_LLM → PROCESSING_RESPONSE
 *     → (tool_use) → EXECUTING_TOOLS → ASSEMBLING_CONTEXT (loop back)
 *     → (end_turn) → WAITING_FOR_EVENT
 *     → (safety breach) → SAFETY_LOCKOUT
 *
 * The loop no longer accepts raw strings. It pulls InputEvent objects
 * from the EventQueue — the core's **sole input source**.
 */

import type {
  EventBus,
  Message,
  ContentSegment,
  ToolCallRequest,
  ToolCallResult,
  IProvider,
  ChatRequest,
  IContextManager,
  ISessionManager,
  IGuide,
  ToolContext,
  InputEvent,
} from "@openstarry/sdk";
import { AgentEventType } from "@openstarry/sdk";
import { generateId, createLogger, validateInput } from "@openstarry/shared";
import type { ToolRegistry } from "../infrastructure/tool-registry.js";
import type { SecurityLayer } from "../security/guardrails.js";
import type { EventQueue } from "./queue.js";
import type { SafetyMonitor } from "../security/safety-monitor.js";

const logger = createLogger("ExecutionLoop");

export type LoopState =
  | "WAITING_FOR_EVENT"
  | "ASSEMBLING_CONTEXT"
  | "AWAITING_LLM"
  | "PROCESSING_RESPONSE"
  | "EXECUTING_TOOLS"
  | "SAFETY_LOCKOUT";

export interface ExecutionLoopDeps {
  bus: EventBus;
  queue: EventQueue;
  sessionManager: ISessionManager;
  contextManager: IContextManager;
  toolRegistry: ToolRegistry;
  security: SecurityLayer;
  safetyMonitor: SafetyMonitor;
  providerResolver: (sessionId?: string) => IProvider;
  guideResolver: () => IGuide | undefined;
  /** Returns the currently selected model ID, or undefined if none selected. */
  modelResolver: (sessionId?: string) => string | undefined;
  maxToolRounds: number;
  slidingWindowSize: number;
  workingDirectory: string;
  temperature?: number;
  maxTokens?: number;
  /** Tool execution timeout in ms (default: 30000). */
  toolTimeout?: number;
}

export interface ExecutionLoop {
  /** Start the event loop — pulls from EventQueue continuously. */
  start(): void;
  /** Stop the event loop gracefully. */
  stop(): void;
  /** Process a single input event (called internally or for direct invocation). */
  processEvent(inputEvent: InputEvent): Promise<void>;
  /** Get current state. */
  getState(): LoopState;
  /** Whether the loop is currently processing an event. */
  isProcessing(): boolean;
}

export function createExecutionLoop(deps: ExecutionLoopDeps): ExecutionLoop {
  let state: LoopState = "WAITING_FOR_EVENT";
  let running = false;
  let processing = false;

  function emitEvent(type: string, payload?: unknown): void {
    deps.bus.emit({ type, timestamp: Date.now(), payload });
  }

  function setState(newState: LoopState): void {
    state = newState;
  }

  async function executeTool(
    toolCall: ToolCallRequest,
    sessionId: string | undefined,
    replyTo: string | undefined,
  ): Promise<ToolCallResult> {
    const tool = deps.toolRegistry.get(toolCall.name);
    if (!tool) {
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        result: `Error: Tool "${toolCall.name}" not found.`,
        isError: true,
      };
    }

    emitEvent(AgentEventType.TOOL_EXECUTING, {
      toolCallId: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
      sessionId,
      replyTo,
    });

    try {
      const validation = validateInput(tool.parameters, toolCall.arguments);
      if (!validation.success) {
        const errMsg = `Invalid arguments for tool "${toolCall.name}": ${validation.error}`;
        emitEvent(AgentEventType.TOOL_ERROR, {
          toolCallId: toolCall.id,
          name: toolCall.name,
          error: errMsg,
          sessionId,
          replyTo,
        });
        return {
          toolCallId: toolCall.id,
          name: toolCall.name,
          result: errMsg,
          isError: true,
        };
      }

      const toolCtx: ToolContext = {
        workingDirectory: deps.workingDirectory,
        allowedPaths: deps.security.getAllowedPaths(),
        bus: deps.bus,
      };

      const timeout = deps.toolTimeout ?? 30000;
      const resultPromise = tool.execute(validation.data!, toolCtx);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Tool "${toolCall.name}" timed out after ${timeout}ms`)),
          timeout,
        );
      });
      const result = await Promise.race([resultPromise, timeoutPromise]);
      emitEvent(AgentEventType.TOOL_RESULT, {
        toolCallId: toolCall.id,
        name: toolCall.name,
        result,
        sessionId,
        replyTo,
      });

      return { toolCallId: toolCall.id, name: toolCall.name, result };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Tool execution error: ${toolCall.name}`, { error: errMsg });
      emitEvent(AgentEventType.TOOL_ERROR, {
        toolCallId: toolCall.id,
        name: toolCall.name,
        error: errMsg,
        sessionId,
        replyTo,
      });
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        result: `Error executing tool "${toolCall.name}": ${errMsg}`,
        isError: true,
      };
    }
  }

  /**
   * Process a single input event through the full cognition cycle.
   */
  async function processEvent(inputEvent: InputEvent): Promise<void> {
    if (state === "SAFETY_LOCKOUT") {
      emitEvent(AgentEventType.SAFETY_LOCKOUT, {
        error: "Agent is in safety lockout. Use /reset to unlock.",
      });
      return;
    }

    processing = true;

    // Resolve session-specific state manager
    const sessionId = inputEvent.sessionId;
    const replyTo = inputEvent.replyTo;
    const stateManager = deps.sessionManager.getStateManager(sessionId);

    // Generate traceId for this event processing cycle
    const traceId = generateId();
    logger.setContext({ traceId });

    // Add user message to state
    const userText =
      typeof inputEvent.data === "string"
        ? inputEvent.data
        : JSON.stringify(inputEvent.data);

    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content: [{ type: "text", text: userText }],
      createdAt: Date.now(),
    };
    stateManager.addMessage(userMessage);
    emitEvent(AgentEventType.MESSAGE_USER, {
      message: userMessage,
      source: inputEvent.source,
      sessionId,
      replyTo,
    });
    emitEvent(AgentEventType.LOOP_STARTED, { source: inputEvent.source, traceId, sessionId, replyTo });

    // Safety: notify monitor of new loop start
    deps.safetyMonitor.onLoopStart();

    let toolRound = 0;
    let continueLoop = true;

    while (continueLoop && toolRound <= deps.maxToolRounds) {
      // Safety: check loop tick limit
      const tickCheck = deps.safetyMonitor.onLoopTick();
      if (tickCheck.halt) {
        setState("SAFETY_LOCKOUT");
        emitEvent(AgentEventType.SAFETY_LOCKOUT, { error: tickCheck.reason, sessionId, replyTo });
        emitEvent(AgentEventType.MESSAGE_SYSTEM, { text: tickCheck.reason, sessionId, replyTo });
        break;
      }

      // Phase 1: Assemble context
      setState("ASSEMBLING_CONTEXT");
      emitEvent(AgentEventType.LOOP_ASSEMBLING_CONTEXT, { round: toolRound, sessionId, replyTo });

      const allMessages = stateManager.getMessages();
      const contextMessages = deps.contextManager.assembleContext(
        allMessages,
        deps.slidingWindowSize,
      );

      let systemPrompt: string | undefined;
      const guide = deps.guideResolver();
      if (guide) {
        systemPrompt = await guide.getSystemPrompt();
      }

      // Safety: check token budget before LLM call
      const budgetCheck = deps.safetyMonitor.beforeLLMCall();
      if (budgetCheck.halt) {
        setState("SAFETY_LOCKOUT");
        emitEvent(AgentEventType.SAFETY_LOCKOUT, { error: budgetCheck.reason, sessionId, replyTo });
        emitEvent(AgentEventType.MESSAGE_SYSTEM, { text: budgetCheck.reason, sessionId, replyTo });
        break;
      }

      // Phase 2: Call LLM
      setState("AWAITING_LLM");

      const currentModel = deps.modelResolver(sessionId);
      if (!currentModel) {
        emitEvent(AgentEventType.LOOP_ERROR, {
          error: "No model selected. Use /provider model <id> to choose a model.",
          sessionId,
          replyTo,
        });
        continueLoop = false;
        break;
      }

      emitEvent(AgentEventType.LOOP_AWAITING_LLM, {
        model: currentModel,
        round: toolRound,
        sessionId,
        replyTo,
      });

      const toolSchemas = deps.toolRegistry.toJsonSchemas();
      const chatRequest: ChatRequest = {
        model: currentModel,
        messages: contextMessages,
        systemPrompt,
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
        temperature: deps.temperature,
        maxTokens: deps.maxTokens,
      };

      // Phase 3: Process stream
      setState("PROCESSING_RESPONSE");

      let textAccumulator = "";
      const pendingToolCalls: ToolCallRequest[] = [];
      const toolCallInputBuffers = new Map<string, string>();
      let stopReason: string = "end_turn";

      const provider = deps.providerResolver(sessionId);

      try {
        for await (const event of provider.chat(chatRequest)) {
          switch (event.type) {
            case "text_delta":
              textAccumulator += event.text;
              emitEvent(AgentEventType.STREAM_TEXT_DELTA, { text: event.text, sessionId, replyTo });
              break;

            case "reasoning_delta":
              emitEvent(AgentEventType.STREAM_REASONING_DELTA, {
                text: event.text,
                sessionId,
                replyTo,
              });
              break;

            case "tool_call_start":
              toolCallInputBuffers.set(event.toolCallId, "");
              emitEvent(AgentEventType.STREAM_TOOL_CALL_START, {
                toolCallId: event.toolCallId,
                name: event.name,
                sessionId,
                replyTo,
              });
              break;

            case "tool_call_delta":
              toolCallInputBuffers.set(
                event.toolCallId,
                (toolCallInputBuffers.get(event.toolCallId) ?? "") +
                  event.input,
              );
              emitEvent(AgentEventType.STREAM_TOOL_CALL_DELTA, {
                toolCallId: event.toolCallId,
                input: event.input,
                sessionId,
                replyTo,
              });
              break;

            case "tool_call_end": {
              const fullInput =
                toolCallInputBuffers.get(event.toolCallId) ?? event.input;
              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = JSON.parse(fullInput) as Record<string, unknown>;
              } catch {
                parsedArgs = {};
              }

              pendingToolCalls.push({
                id: event.toolCallId,
                name: event.name,
                arguments: parsedArgs,
              });

              emitEvent(AgentEventType.STREAM_TOOL_CALL_END, {
                toolCallId: event.toolCallId,
                name: event.name,
                input: fullInput,
                sessionId,
                replyTo,
              });
              break;
            }

            case "finish":
              stopReason = event.stopReason;
              // Track token usage in safety monitor
              if (event.usage) {
                deps.safetyMonitor.trackTokenUsage(
                  event.usage.totalTokens ?? 0,
                );
              }
              emitEvent(AgentEventType.STREAM_FINISH, {
                stopReason: event.stopReason,
                usage: event.usage,
                sessionId,
                replyTo,
              });
              break;

            case "error":
              emitEvent(AgentEventType.STREAM_ERROR, {
                error: event.error.message,
                sessionId,
                replyTo,
              });
              continueLoop = false;
              break;
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error("Provider stream error", { error: errMsg });
        emitEvent(AgentEventType.LOOP_ERROR, { error: errMsg, sessionId, replyTo });
        continueLoop = false;
        break;
      }

      // Build assistant message
      const assistantContent: ContentSegment[] = [];
      if (textAccumulator) {
        assistantContent.push({ type: "text", text: textAccumulator });
      }
      for (const tc of pendingToolCalls) {
        assistantContent.push({ type: "tool_call", toolCall: tc });
      }

      if (assistantContent.length > 0) {
        const assistantMessage: Message = {
          id: generateId(),
          role: "assistant",
          content: assistantContent,
          createdAt: Date.now(),
        };
        stateManager.addMessage(assistantMessage);
        emitEvent(AgentEventType.MESSAGE_ASSISTANT, {
          message: assistantMessage,
          sessionId,
          replyTo,
        });
      }

      // Phase 4: Execute tools if needed
      if (stopReason === "tool_use" && pendingToolCalls.length > 0) {
        setState("EXECUTING_TOOLS");
        toolRound++;

        const toolResults: ToolCallResult[] = [];
        for (const tc of pendingToolCalls) {
          const result = await executeTool(tc, sessionId, replyTo);
          toolResults.push(result);

          // Safety: check after each tool execution
          const toolCheck = deps.safetyMonitor.afterToolExecution(
            tc.name,
            JSON.stringify(tc.arguments),
            result.isError ?? false,
          );
          if (toolCheck.halt) {
            setState("SAFETY_LOCKOUT");
            emitEvent(AgentEventType.SAFETY_LOCKOUT, {
              error: toolCheck.reason,
              sessionId,
              replyTo,
            });
            emitEvent(AgentEventType.MESSAGE_SYSTEM, {
              text: toolCheck.reason,
              sessionId,
              replyTo,
            });
            continueLoop = false;
            break;
          }
          if (toolCheck.injectPrompt) {
            // Inject a system-level warning into the conversation
            const warningMessage: Message = {
              id: generateId(),
              role: "user",
              content: [{ type: "text", text: toolCheck.injectPrompt }],
              createdAt: Date.now(),
            };
            stateManager.addMessage(warningMessage);
            emitEvent(AgentEventType.SAFETY_WARNING, {
              warning: toolCheck.injectPrompt,
              sessionId,
              replyTo,
            });
          }
        }

        if ((state as LoopState) === "SAFETY_LOCKOUT") break;

        // Add tool results as a tool message
        const toolMessage: Message = {
          id: generateId(),
          role: "tool",
          content: toolResults.map((r) => ({
            type: "tool_result" as const,
            toolResult: r,
          })),
          createdAt: Date.now(),
        };
        stateManager.addMessage(toolMessage);

        continueLoop = true;
      } else {
        continueLoop = false;
      }
    }

    if (toolRound > deps.maxToolRounds) {
      logger.warn("Max tool rounds exceeded");
      emitEvent(AgentEventType.LOOP_ERROR, {
        error: "Max tool rounds exceeded",
        sessionId,
        replyTo,
      });
    }

    if ((state as LoopState) !== "SAFETY_LOCKOUT") {
      setState("WAITING_FOR_EVENT");
    }
    emitEvent(AgentEventType.LOOP_FINISHED, { traceId, sessionId, replyTo });
    processing = false;
  }

  /**
   * Start the continuous event loop — pulls from EventQueue.
   */
  function start(): void {
    running = true;
    setState("WAITING_FOR_EVENT");

    // Async loop that runs in the background
    const loop = async () => {
      while (running) {
        const event = await deps.queue.pull();
        if (!running) break;

        const payload = event.payload as InputEvent | undefined;
        if (event.type === AgentEventType.INPUT_RECEIVED && payload) {
          await processEvent(payload);
        }
      }
    };

    loop().catch((err) => {
      logger.error("Event loop crashed", { error: String(err) });
    });
  }

  function stop(): void {
    running = false;
    // Push a dummy event to unblock pull() if it's waiting
    deps.queue.push({
      type: "__SHUTDOWN__",
      timestamp: Date.now(),
    });
  }

  return {
    start,
    stop,
    processEvent,
    getState(): LoopState {
      return state;
    },
    isProcessing(): boolean {
      return processing;
    },
  };
}
