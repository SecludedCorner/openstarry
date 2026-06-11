/**
 * Tests for IVolition Position B integration in ExecutionLoop.
 * Tests the volition deps interface rather than full loop integration.
 * @see execution/loop.ts (Position B)
 */
import { describe, it, expect } from "vitest";
import type {
  PlanDeliberationInput,
  PlanDeliberationResult,
  ActionDeliberationInput,
  ActionDeliberationResult,
  KleshaSignalBundle,
  VedanaAssessment,
  ToolCallInfo,
} from "@openstarry/sdk";

// Test the volition interface contract (ExecutionLoopDeps.volition)
describe("Volition Position B — Interface contract", () => {
  const mockKleshaSignals: KleshaSignalBundle = {
    moha: 0.2,
    drishti: 0.3,
    mana: 0.1,
    sneha: 0.4,
  };

  const mockVedanaAssessment: VedanaAssessment = {
    aggregate: { valence: 0.3, intensity: 0.5, type: "sukha", source: "test" },
    channels: [],
    pidOutput: 0.3,
    timestamp: Date.now(),
  };

  const mockToolCalls: ToolCallInfo[] = [
    { name: "fs.read", arguments: { path: "/test" } },
    { name: "fs.write", arguments: { path: "/out", content: "hello" } },
  ];

  it("deliberatePlan accepts as-is (null modifiedPlan)", async () => {
    const volition = {
      async deliberatePlan(input: PlanDeliberationInput): Promise<PlanDeliberationResult> {
        expect(input.proposedActions).toHaveLength(2);
        expect(input.kleshaSignals.moha).toBe(0.2);
        return { modifiedPlan: null, reasoning: "All actions acceptable" };
      },
      async deliberateAction(input: ActionDeliberationInput): Promise<ActionDeliberationResult> {
        return { veto: false, alternative: null, reasoning: "OK" };
      },
      getKleshaSignals: () => mockKleshaSignals,
      getVedanaAssessment: () => mockVedanaAssessment,
    };

    const result = await volition.deliberatePlan({
      proposedActions: mockToolCalls,
      kleshaSignals: mockKleshaSignals,
      vedanaAssessment: mockVedanaAssessment,
      sessionId: "test-session",
    });

    expect(result.modifiedPlan).toBeNull();
    expect(result.reasoning).toBe("All actions acceptable");
  });

  it("deliberatePlan can modify plan", async () => {
    const volition = {
      async deliberatePlan(input: PlanDeliberationInput): Promise<PlanDeliberationResult> {
        // Remove fs.write from plan
        const filtered = input.proposedActions.filter(a => a.name !== "fs.write");
        return { modifiedPlan: filtered, reasoning: "fs.write blocked by policy" };
      },
      async deliberateAction(): Promise<ActionDeliberationResult> {
        return { veto: false, alternative: null, reasoning: "OK" };
      },
      getKleshaSignals: () => mockKleshaSignals,
      getVedanaAssessment: () => mockVedanaAssessment,
    };

    const result = await volition.deliberatePlan({
      proposedActions: mockToolCalls,
      kleshaSignals: mockKleshaSignals,
      vedanaAssessment: mockVedanaAssessment,
    });

    expect(result.modifiedPlan).toHaveLength(1);
    expect(result.modifiedPlan![0].name).toBe("fs.read");
  });

  it("deliberateAction can veto an action", async () => {
    const planResult: PlanDeliberationResult = {
      modifiedPlan: null,
      reasoning: "Plan OK",
    };

    const volition = {
      async deliberatePlan(): Promise<PlanDeliberationResult> {
        return planResult;
      },
      async deliberateAction(input: ActionDeliberationInput): Promise<ActionDeliberationResult> {
        if (input.proposedAction.name === "fs.write") {
          return {
            veto: true,
            alternative: { name: "fs.read", arguments: { path: (input.proposedAction.arguments as Record<string, string>).path } },
            reasoning: "Write not permitted, suggesting read instead",
          };
        }
        return { veto: false, alternative: null, reasoning: "Permitted" };
      },
      getKleshaSignals: () => mockKleshaSignals,
      getVedanaAssessment: () => mockVedanaAssessment,
    };

    const writeResult = await volition.deliberateAction({
      proposedAction: mockToolCalls[1],
      kleshaSignals: mockKleshaSignals,
      vedanaAssessment: mockVedanaAssessment,
      planContext: planResult,
    });

    expect(writeResult.veto).toBe(true);
    expect(writeResult.alternative?.name).toBe("fs.read");

    const readResult = await volition.deliberateAction({
      proposedAction: mockToolCalls[0],
      kleshaSignals: mockKleshaSignals,
      vedanaAssessment: mockVedanaAssessment,
      planContext: planResult,
    });

    expect(readResult.veto).toBe(false);
  });

  it("supports optional sessionId", async () => {
    const volition = {
      async deliberatePlan(input: PlanDeliberationInput): Promise<PlanDeliberationResult> {
        expect(input.sessionId).toBeUndefined();
        return { modifiedPlan: null, reasoning: "OK" };
      },
      async deliberateAction(): Promise<ActionDeliberationResult> {
        return { veto: false, alternative: null, reasoning: "OK" };
      },
      getKleshaSignals: () => mockKleshaSignals,
      getVedanaAssessment: () => mockVedanaAssessment,
    };

    const result = await volition.deliberatePlan({
      proposedActions: [],
      kleshaSignals: mockKleshaSignals,
      vedanaAssessment: mockVedanaAssessment,
    });
    expect(result.reasoning).toBe("OK");
  });
});
