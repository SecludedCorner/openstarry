/**
 * scripted-provider — deterministic provider fixture for the fractal
 * composition e2e proof (TENET-2026-06-11, Tenet #10). Loaded via
 * PluginRef.path (no build step); the module-level factory receives the
 * per-plugin `config` from the agent JSON (plugin-resolver path strategy).
 *
 * Modes:
 *   { mode: "parent", delegateTool: "child-agent/agent.ask" }
 *     Round 1 (no tool_result in context): emit a tool call to delegateTool
 *     with {prompt: <last user text>} and finish(tool_use).
 *     Round 2 (tool_result present): emit `PARENT-FINAL:<result>` and
 *     finish(end_turn).
 *   { mode: "child", breadcrumb: "<path>" }
 *     Write `${process.pid}` to the breadcrumb file once (proves the child's
 *     own cognition ran in its own process), then answer
 *     `CHILD-ANSWER:<pid>:<USER TEXT UPPERCASED>` and finish(end_turn).
 */

import { writeFileSync } from "node:fs";

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const texts = (m.content ?? [])
      .filter((s) => s.type === "text" && typeof s.text === "string")
      .map((s) => s.text);
    if (texts.length > 0) return texts.join("");
  }
  return "";
}

function lastToolResult(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const segments = messages[i].content ?? [];
    for (let j = segments.length - 1; j >= 0; j--) {
      const s = segments[j];
      if (s.type === "tool_result" && s.toolResult) return s.toolResult;
    }
  }
  return null;
}

export default function createScriptedProviderPlugin(config = {}) {
  const mode = config.mode ?? "child";
  const delegateTool = config.delegateTool ?? "child-agent/agent.ask";
  // finalPrefix lets depth-3 chains distinguish layers (e.g. "MID-FINAL:").
  const finalPrefix = config.finalPrefix ?? "PARENT-FINAL:";
  const breadcrumb = config.breadcrumb;
  let breadcrumbWritten = false;

  const provider = {
    id: "scripted",
    name: `Scripted Provider (${mode})`,
    models: [{ id: "scripted-1", name: "Scripted Model" }],

    async *chat(request) {
      const messages = request.messages ?? [];

      if (mode === "parent") {
        const toolResult = lastToolResult(messages);
        if (toolResult === null) {
          const prompt = lastUserText(messages);
          const input = JSON.stringify({ prompt });
          const toolCallId = `delegate-${Date.now()}`;
          yield { type: "tool_call_start", toolCallId, name: delegateTool };
          yield { type: "tool_call_delta", toolCallId, input };
          yield { type: "tool_call_end", toolCallId, name: delegateTool, input };
          yield { type: "finish", stopReason: "tool_use" };
          return;
        }
        yield { type: "text_delta", text: `${finalPrefix}${toolResult.result}` };
        yield { type: "finish", stopReason: "end_turn" };
        return;
      }

      // child mode
      if (breadcrumb && !breadcrumbWritten) {
        breadcrumbWritten = true;
        try { writeFileSync(breadcrumb, String(process.pid), "utf-8"); } catch { /* best-effort */ }
      }
      const text = lastUserText(messages);
      yield { type: "text_delta", text: `CHILD-ANSWER:${process.pid}:${text.toUpperCase()}` };
      yield { type: "finish", stopReason: "end_turn" };
    },
  };

  return {
    manifest: {
      name: "scripted-provider",
      version: "0.1.0-test",
      description: "Deterministic scripted provider for fractal e2e",
      skandha: "samjna",
    },
    factory: async () => ({ providers: [provider] }),
  };
}
