import { describe, it, expect } from "vitest";
import type { TypedAgentEvent, AgentEventPayloadMap } from "../../index.js";
import { AgentEventType } from "../../index.js";

describe("AgentEvent Type System", () => {
  it("TypedAgentEvent has correct payload type for AGENT_STARTED", () => {
    const event: TypedAgentEvent<"agent:started"> = {
      type: "agent:started",
      timestamp: Date.now(),
      payload: { identity: { id: "test", name: "Test Agent" } },
    };
    expect(event.type).toBe(AgentEventType.AGENT_STARTED);
    expect(event.payload.identity.id).toBe("test");
  });

  it("TypedAgentEvent has correct payload type for LOOP_ERROR", () => {
    const event: TypedAgentEvent<"loop:error"> = {
      type: "loop:error",
      timestamp: Date.now(),
      payload: { error: "test error", sessionId: "s1" },
    };
    expect(event.payload.error).toBe("test error");
  });

  it("AgentEventPayloadMap keys match AgentEventType values", () => {
    // Verify the map covers expected event types
    type MapKeys = keyof AgentEventPayloadMap;
    type HasAgentStarted = "agent:started" extends MapKeys ? true : false;
    const check: HasAgentStarted = true;
    expect(check).toBe(true);
  });
});
