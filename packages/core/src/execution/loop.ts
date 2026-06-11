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
  PlanDeliberationInput,
  PlanDeliberationResult,
  ActionDeliberationInput,
  ActionDeliberationResult,
  KleshaSignalBundle,
  VedanaAssessment,
  IGearArbiter,
  RouteResult,
  ActionRecord,
  ConfirmationRequest,
  ConfirmationDecision,
  UserConfirmationResponse,
  IConfidenceAuditor,
} from "@openstarry/sdk";
import { AgentEventType, inferRiskCategory, TOOL_CONFIDENCE_TABLE, DEFAULT_CONFIDENCE_AUDIT_CONFIG } from "@openstarry/sdk";
import { createHash, randomBytes } from "node:crypto";
import { generateId, createLogger, validateInput } from "@openstarry/shared";
import type { ToolRegistry } from "../infrastructure/tool-registry.js";
import type { SecurityLayer } from "../security/guardrails.js";
import type { EventQueue } from "./queue.js";
import type { SafetyMonitor } from "../security/safety-monitor.js";
import type { ManoAggregator } from "../mano/mano-aggregator.js";
import type { MonitorRegistry } from "../infrastructure/monitor-registry.js";
import { buildGearContext } from "../mano/gear-context-builder.js";
import { createSparshEvent } from "../mano/sparsh-event-builder.js";
import { resolvePersonaAndApply } from "./guide-adapter.js";

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
  /** Tool execution timeout in ms. */
  toolTimeout: number;
  /** LLM call timeout in ms. */
  llmTimeout: number;
  /** ManoAggregator — optional gear routing (Plan27, wired in Plan27b). */
  manoAggregator?: ManoAggregator;
  /** GearArbiterRegistry — optional, provides sorted arbiter list for ManoAggregator (Plan27b). */
  gearArbiterRegistry?: { listSorted(): IGearArbiter[] };
  /** MonitorRegistry — optional loop quality monitors (Plan29). */
  monitorRegistry?: MonitorRegistry;
  /** IVolition Position B — optional two-phase deliberation before tool execution (Plan26+28). */
  volition?: {
    deliberatePlan(input: PlanDeliberationInput): Promise<PlanDeliberationResult>;
    deliberateAction(input: ActionDeliberationInput): Promise<ActionDeliberationResult>;
    getKleshaSignals(sessionId?: string): KleshaSignalBundle;
    getVedanaAssessment(sessionId?: string): VedanaAssessment;
  };
  /** T3 Confirmation Gate — optional pre-execution confirmation (Plan36b). */
  confirmationGate?: {
    evaluate(request: ConfirmationRequest): ConfirmationDecision | Promise<ConfirmationDecision>;
  };
  /** IConfidenceAuditor for B-modified delta injection on tool_audited path. Plan39 W1. */
  auditor?: IConfidenceAuditor;
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

      const timeout = deps.toolTimeout;
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

    // Action history for gear context (Plan27b)
    const actionHistory: ActionRecord[] = [];

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

    // Emit sparsha:contact event (Plan27b P27-P)
    const sparshEvent = createSparshEvent(inputEvent);
    emitEvent("sparsha:contact", { sparshEvent, sessionId });

    // Safety: notify monitor of new loop start
    deps.safetyMonitor.onLoopStart();

    let toolRound = 0;
    let continueLoop = true;
    let loopErrored = false;
    // Per-cycle cumulative clamped delta accumulator. Resets at cycle boundary (CONSTRAINT-D4a).
    // Tracks total clamped audit delta across all tool executions in this cycle.
    // Does NOT touch historicalBuffer (which lives in mano-aggregator).
    let cumulativeClampedDelta = 0;

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

      // Cycle 03-33 F-CY32 Option 2 (Batch 27 Item #13): inject persona via
      // messages[0] as { role: "system" } instead of the top-level systemPrompt
      // field. Anthropic-class converters re-extract system messages into the
      // top-level system field (canonical mapping); OpenAI-class converters
      // expect system in messages[] by design; CLI subprocess providers emit
      // it as the leading transcript line. See execution/guide-adapter.ts.
      const guide = deps.guideResolver();
      const messagesForLlm = await resolvePersonaAndApply(contextMessages, guide);

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
        process.exitCode = 1;
        emitEvent(AgentEventType.LOOP_ERROR, {
          error: "No model selected. Use /provider model <id> to choose a model.",
          fatal: true,
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

      // Create AbortController for LLM call timeout
      const llmTimeout = deps.llmTimeout;
      const abortController = new AbortController();
      const llmTimer = setTimeout(() => {
        abortController.abort(new Error(`LLM call timed out after ${llmTimeout}ms`));
      }, llmTimeout);

      const toolSchemas = deps.toolRegistry.toJsonSchemas();
      const chatRequest: ChatRequest = {
        model: currentModel,
        messages: messagesForLlm,
        // F-CY32 Option 2: persona is now in messages[0] (see guide-adapter.ts);
        // chatRequest.systemPrompt left undefined here so provider converters use
        // the messages[]-borne system role as the single source of truth.
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
        temperature: deps.temperature,
        maxTokens: deps.maxTokens,
        signal: abortController.signal,
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
              process.exitCode = 1;
              emitEvent(AgentEventType.LOOP_ERROR, {
                error: event.error.message,
                fatal: true,
                sessionId,
                replyTo,
              });
              loopErrored = true;
              continueLoop = false;
              break;
          }
        }
        clearTimeout(llmTimer);
      } catch (err) {
        clearTimeout(llmTimer);
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error("Provider stream error", { error: errMsg });
        process.exitCode = 1;
        emitEvent(AgentEventType.LOOP_ERROR, { error: errMsg, fatal: true, sessionId, replyTo });
        loopErrored = true;
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

      // Phase 2.5: ManoAggregator routing (Plan27b)
      let routeResult: RouteResult | null = null;
      let currentGear: number | undefined;
      if (stopReason === "tool_use" && pendingToolCalls.length > 0 && deps.manoAggregator) {
        const gearContext = buildGearContext(
          userText,
          pendingToolCalls,
          actionHistory,
          { id: createHash('sha256').update(deps.workingDirectory).digest('hex').slice(0, 16) },
          sessionId,
        );
        const arbiters = deps.gearArbiterRegistry
          ? deps.gearArbiterRegistry.listSorted()
          : [];
        routeResult = await deps.manoAggregator.route(gearContext, arbiters);
        // Phase 2.5b: postRouteCheck safety gate (Plan28)
        if (routeResult && deps.safetyMonitor.postRouteCheck) {
          routeResult = deps.safetyMonitor.postRouteCheck(routeResult);
        }
        currentGear = routeResult.gear;
      }

      // Phase 3.5: IVolition Position B — Plan-level deliberation (Plan26)
      // routeResult available here for Plan28 IVolition v1 consumption
      let planDeliberationResult: PlanDeliberationResult | null = null;
      if (stopReason === "tool_use" && pendingToolCalls.length > 0 && deps.volition) {
        const kleshaSignals = deps.volition.getKleshaSignals(sessionId);
        const vedanaAssessment = deps.volition.getVedanaAssessment(sessionId);

        // Phase 1: Plan-level deliberation (1-3ms, vijnana-clock)
        planDeliberationResult = await deps.volition.deliberatePlan({
          proposedActions: pendingToolCalls.map(tc => ({ name: tc.name, arguments: tc.arguments })),
          kleshaSignals,
          vedanaAssessment,
          sessionId,
          // Plan28: pass routing context for risk-aware deliberation
          deliberationContext: routeResult ? { routeResult, actionHistory } : undefined,
        });

        // Apply modified plan if volition rewrites it
        if (planDeliberationResult.modifiedPlan) {
          const approved = planDeliberationResult.modifiedPlan;
          const filtered = pendingToolCalls.filter(tc =>
            approved.some(m => m.name === tc.name));
          pendingToolCalls.length = 0;
          pendingToolCalls.push(...filtered);
        }

        emitEvent(AgentEventType.VOLITION_DELIBERATION, {
          reasoning: planDeliberationResult.reasoning,
          modified: !!planDeliberationResult.modifiedPlan,
          sessionId,
        });
      }

      // Phase 4: Execute tools if needed
      if (stopReason === "tool_use" && pendingToolCalls.length > 0) {
        setState("EXECUTING_TOOLS");
        toolRound++;

        const toolResults: ToolCallResult[] = [];
        let auditEventCount = 0;
        for (const tc of pendingToolCalls) {
          // Phase 2: Per-action deliberation (0.5-1ms each, vijnana-clock) (Plan26)
          if (deps.volition && planDeliberationResult) {
            const actionResult = await deps.volition.deliberateAction({
              proposedAction: { name: tc.name, arguments: tc.arguments },
              kleshaSignals: deps.volition.getKleshaSignals(sessionId),
              vedanaAssessment: deps.volition.getVedanaAssessment(sessionId),
              planContext: planDeliberationResult,
              // Plan28: pass routing context for risk-aware deliberation
              deliberationContext: routeResult ? { routeResult, actionHistory } : undefined,
            });
            if (actionResult.veto) {
              emitEvent(AgentEventType.VOLITION_VETO, {
                action: tc.name,
                reasoning: actionResult.reasoning,
                alternative: actionResult.alternative,
                sessionId,
              });
              continue; // Skip this vetoed tool call
            }
          }

          // T3 Confirmation Gate — after IVolition, before executeTool (Plan36b, D2-R10)
          if (deps.confirmationGate) {
            const confirmRequest: ConfirmationRequest = {
              toolCallId: tc.id,
              toolName: tc.name,
              toolArguments: tc.arguments,
              riskCategory: routeResult?.riskCategory,
              gear: currentGear,
              sessionId,
            };

            let gateDecision: ConfirmationDecision;
            try {
              gateDecision = await deps.confirmationGate.evaluate(confirmRequest);
            } catch (gateError) {
              // D2-R8: Fail-closed on gate error (enforcement component)
              emitEvent(AgentEventType.TOOL_BLOCKED, {
                toolCallId: tc.id,
                name: tc.name,
                reason: `Confirmation gate error: ${(gateError as Error).message}`,
                sessionId,
                replyTo,
              });
              continue;
            }

            if (gateDecision.action === 'deny') {
              emitEvent(AgentEventType.TOOL_BLOCKED, {
                toolCallId: tc.id,
                name: tc.name,
                reason: `Confirmation gate denied: ${gateDecision.reasoning}`,
                sessionId,
                replyTo,
              });
              continue;
            }

            if (gateDecision.action === 'ask_user') {
              const nonce = randomBytes(16).toString('hex');
              const timeoutMs = gateDecision.timeoutMs ?? 30000;

              emitEvent(AgentEventType.CONFIRMATION_REQUEST, {
                toolCallId: tc.id,
                toolName: tc.name,
                toolArguments: tc.arguments,
                prompt: gateDecision.prompt,
                timeoutMs,
                sessionId,
                nonce,
              });

              const userResponse = await waitForConfirmation(
                deps.bus, tc.id, nonce, timeoutMs,
              );

              if (!userResponse || !userResponse.approved) {
                emitEvent(AgentEventType.TOOL_BLOCKED, {
                  toolCallId: tc.id,
                  name: tc.name,
                  reason: userResponse
                    ? `User denied: ${userResponse.reasoning ?? 'no reason'}`
                    : 'Confirmation timeout (default-deny)',
                  sessionId,
                  replyTo,
                });
                continue;
              }
              // User approved — fall through
            }
            // 'approve' — fall through
          }

          // Emit action:proposed (Plan27b P27-U) — only for approved actions (Plan36b)
          emitEvent("action:proposed", {
            gear: currentGear,
            action: { name: tc.name, arguments: tc.arguments },
          });

          const result = await executeTool(tc, sessionId, replyTo);
          toolResults.push(result);

          // Per-tool audit event (Plan37 C2, D1-R1) — fail-open, non-blocking
          try {
            const riskCat = inferRiskCategory(tc.name);
            // Plan40 W0: Delta scaling factor for B-modified path (tool_audited events only)
            // Derivation: (maxDelta / max(TOOL_CONFIDENCE_TABLE)) * HEADROOM_FACTOR
            //           = (0.05 / 0.85) * 0.935 ≈ 0.055
            // Ensures: max scaled delta (destructive) = 0.85 * 0.055 = 0.04675 < 0.05
            // See: cycle03-4 W2-R3/R4 calibration
            const DELTA_SCALING_FACTOR = 0.055;
            const signMultiplier = (riskCat === 'destructive' || riskCat === 'state_modifying') ? -1 : 1;
            const rawDelta = TOOL_CONFIDENCE_TABLE[riskCat] * signMultiplier * DELTA_SCALING_FACTOR;
            const maxDelta = DEFAULT_CONFIDENCE_AUDIT_CONFIG.maxAuditDelta;
            const clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, rawDelta));
            // B-modified: if auditor present, use its delta instead (Plan39 W1 Decision B)
            let finalRaw = rawDelta;
            let finalClamped = clampedDelta;
            if (deps.auditor) {
              try {
                const auditRouteResult: RouteResult = {
                  gear: routeResult?.gear ?? 2,
                  confidence: rawDelta,
                  decidedBy: `tool_audited:${tc.name}`,
                  riskCategory: riskCat,
                  riskAdjusted: false,
                };
                const auditResult = await deps.auditor.audit(auditRouteResult);
                finalRaw = auditResult.delta;
                finalClamped = Math.max(-maxDelta, Math.min(maxDelta, auditResult.delta));
              } catch {
                // fail-open: auditor failure falls back to table-based delta
              }
            }
            cumulativeClampedDelta += finalClamped; // CONSTRAINT-D4a: accumulate per-cycle
            emitEvent("audit:tool_audited", {
              toolName: tc.name,
              inferredRiskCategory: riskCat,
              executionResult: (result.isError ?? false) ? 'error' : 'success',
              batchIndex: toolResults.length - 1,
              batchSize: pendingToolCalls.length,
              routeRiskCategory: routeResult?.riskCategory ?? 'informational',
              rawDelta: finalRaw,
              clampedDelta: finalClamped,
              decidedBy: `tool_audited:${tc.name}`,
              timestamp: Date.now(),
            });
            auditEventCount++;
          } catch {
            // fail-open: audit event failure must not block tool execution (Rule #29)
          }

          // Emit action:executed (Plan27b P27-U)
          emitEvent("action:executed", {
            gear: currentGear,
            success: !(result.isError ?? false),
          });

          // Track action for gear context history (Plan27b)
          actionHistory.push({
            name: tc.name,
            success: !(result.isError ?? false),
            timestamp: Date.now(),
          });

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

        // Must-invoke audit count verification (Plan37 C4, D1-R4)
        if (auditEventCount !== toolResults.length) {
          logger.warn(
            `Must-invoke audit gap: emitted ${auditEventCount} audit:tool_audited events for ${toolResults.length} tool results`
          );
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
      process.exitCode = 1;
      emitEvent(AgentEventType.LOOP_ERROR, {
        error: "Max tool rounds exceeded",
        fatal: true,
        sessionId,
        replyTo,
      });
    }

    if ((state as LoopState) !== "SAFETY_LOCKOUT") {
      setState("WAITING_FOR_EVENT");
    }
    if (!loopErrored) {
      // Emit per-cycle sigma for W5 calibration (CONSTRAINT-D4a/D4c).
      // cumulativeClampedDelta is reset at the top of each processInput() call.
      emitEvent("audit:cycle_sigma", { cumulativeClampedDelta, sessionId });
      emitEvent(AgentEventType.LOOP_FINISHED, { traceId, sessionId, replyTo });
    }
    processing = false;
  }

  /**
   * Wait for user confirmation response with nonce validation and timeout.
   * Returns null on timeout (→ default-deny per D2-R2, WIENER C-2).
   */
  function waitForConfirmation(
    bus: EventBus,
    toolCallId: string,
    expectedNonce: string,
    timeoutMs: number,
  ): Promise<UserConfirmationResponse | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsub();
        resolve(null); // Timeout = default-deny (D2-R2)
      }, timeoutMs);

      const unsub = bus.on(AgentEventType.CONFIRMATION_RESPONSE, (event) => {
        const payload = event.payload as {
          toolCallId: string;
          nonce: string;
          approved: boolean;
          reasoning?: string;
        } | undefined;
        if (payload?.toolCallId === toolCallId && payload?.nonce === expectedNonce) {
          clearTimeout(timer);
          unsub();
          resolve({ approved: payload.approved, reasoning: payload.reasoning });
        }
        // Mismatched nonce: silently ignore (anti-spoofing, D2-R7)
      });
    });
  }

  /**
   * Start the continuous event loop — pulls from EventQueue.
   */
  function start(): void {
    running = true;
    setState("WAITING_FOR_EVENT");

    // Reset lockout state on STATE_RESET (e.g., /reset command)
    deps.bus.on(AgentEventType.STATE_RESET, () => {
      if (state === "SAFETY_LOCKOUT") {
        logger.info("STATE_RESET received — clearing safety lockout");
        setState("WAITING_FOR_EVENT");
      }
    });

    // Start loop quality monitors (Plan29)
    if (deps.monitorRegistry) {
      deps.monitorRegistry.startAll(deps.bus);
    }

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
    // Stop loop quality monitors (Plan29)
    if (deps.monitorRegistry) {
      deps.monitorRegistry.stopAll();
    }
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
