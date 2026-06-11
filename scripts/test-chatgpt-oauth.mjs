/**
 * Full pipeline test: ChatGPT OAuth → Codex Responses API → tool calling
 */
import { createAgentCore } from "../packages/core/dist/index.js";
import { AgentEventType } from "../packages/sdk/dist/index.js";
import { resolvePlugins } from "../apps/runner/dist/utils/plugin-resolver.js";

const config = {
  identity: { id: "smoke-chatgpt", name: "ChatGPT OAuth Test" },
  cognition: {
    provider: "chatgpt-oauth",
    model: "gpt-5.1-codex-mini",
    temperature: 0.3,
    maxTokens: 4096,
    maxToolRounds: 3,
  },
  capabilities: {
    tools: ["fs.list"],
    allowedPaths: ["C:\\tmp"],
  },
  policy: { maxConcurrentTools: 1, toolTimeout: 30000 },
  memory: { slidingWindowSize: 3 },
  plugins: [
    { name: "@openstarry-plugin/provider-chatgpt-oauth" },
    { name: "@openstarry-plugin/standard-function-fs" },
    { name: "@openstarry-plugin/context-sliding-window" },
    { name: "@openstarry-plugin/gear-arbiter-static" },
    { name: "@openstarry-plugin/auditor-threshold" },
  ],
};

const core = createAgentCore(config);
const pluginResult = await resolvePlugins(config, true, null);
for (const plugin of pluginResult.plugins) {
  await core.loadPlugin(plugin);
}

// Track events
const events = [];
core.bus.on(AgentEventType.LOOP_STARTED, () => { events.push("LOOP_STARTED"); console.log("[event] LOOP_STARTED"); });
core.bus.on(AgentEventType.LOOP_FINISHED, () => { events.push("LOOP_FINISHED"); console.log("[event] LOOP_FINISHED"); });
core.bus.on(AgentEventType.LOOP_ERROR, (e) => { events.push("LOOP_ERROR"); console.log("[event] LOOP_ERROR:", JSON.stringify(e.payload).slice(0, 200)); });
core.bus.on(AgentEventType.TOOL_EXECUTING, (e) => { events.push("TOOL_EXECUTING"); console.log("[event] TOOL_EXECUTING:", JSON.stringify(e.payload).slice(0, 100)); });
core.bus.on(AgentEventType.STREAM_TEXT, (e) => { process.stdout.write(e.payload?.text || ""); });

await core.start();
console.log("\nAgent started. Sending input...\n");

core.pushInput({ inputType: "user_message", data: "List files in C:\\tmp using the fs.list tool" });

await new Promise((resolve) => {
  const timeout = setTimeout(() => { console.log("\n[timeout]"); resolve(); }, 60000);
  const check = setInterval(() => {
    if (events.some(e => e === "LOOP_FINISHED" || e === "LOOP_ERROR")) {
      clearInterval(check); clearTimeout(timeout);
      setTimeout(resolve, 2000);
    }
  }, 500);
});

await core.stop();

console.log("\n\n=== Results ===");
console.log("Events:", events.join(", "));
const hasToolUse = events.includes("TOOL_EXECUTING");
const hasFinish = events.includes("LOOP_FINISHED");
const hasError = events.includes("LOOP_ERROR");

if (hasFinish && hasToolUse) {
  console.log("\n✅ PASS — Tool called + LOOP_FINISHED");
} else if (hasFinish && !hasToolUse) {
  console.log("\n⚠️  LOOP_FINISHED but no tool call — model chose not to use tool");
} else if (hasError) {
  console.log("\n❌ LOOP_ERROR");
} else {
  console.log("\n❌ No completion event");
}

process.exit(0);
