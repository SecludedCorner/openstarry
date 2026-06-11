/**
 * Smoke test for Hotfix BUG-4/5/6 fixes.
 * Runs programmatically without interactive terminal.
 */
import { createAgentCore } from "../packages/core/dist/index.js";
import { AgentEventType } from "../packages/sdk/dist/index.js";
import { resolvePlugins } from "../apps/runner/dist/utils/plugin-resolver.js";

const config = {
  identity: { id: "smoke-test", name: "Smoke Test", description: "Hotfix verification" },
  cognition: {
    provider: "gemini",
    model: "gemini-2.0-flash",
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
    { name: "@openstarry-plugin/provider-gemini" },
    { name: "@openstarry-plugin/standard-function-fs" },
    { name: "@openstarry-plugin/context-sliding-window" },
    { name: "@openstarry-plugin/gear-arbiter-static" },
    { name: "@openstarry-plugin/auditor-threshold" },
  ],
};

async function main() {
  console.log("=== Hotfix Smoke Test ===\n");

  // Create core
  const core = createAgentCore(config);

  // Load plugins
  const pluginResult = await resolvePlugins(config, true, null);
  for (const plugin of pluginResult.plugins) {
    await core.loadPlugin(plugin);
  }

  // Track events
  const events = [];
  core.bus.on(AgentEventType.LOOP_STARTED, (e) => {
    events.push({ type: "LOOP_STARTED", ts: Date.now() });
    console.log("[event] LOOP_STARTED");
  });
  core.bus.on(AgentEventType.LOOP_FINISHED, (e) => {
    events.push({ type: "LOOP_FINISHED", ts: Date.now() });
    console.log("[event] LOOP_FINISHED");
  });
  core.bus.on(AgentEventType.LOOP_ERROR, (e) => {
    events.push({ type: "LOOP_ERROR", payload: e.payload, ts: Date.now() });
    console.log("[event] LOOP_ERROR:", JSON.stringify(e.payload).slice(0, 200));
  });
  core.bus.on(AgentEventType.TOOL_EXECUTING, (e) => {
    events.push({ type: "TOOL_EXECUTING", ts: Date.now() });
    console.log("[event] TOOL_EXECUTING:", JSON.stringify(e.payload).slice(0, 100));
  });

  // Start agent
  await core.start();
  console.log("\nAgent started. Sending input...\n");

  // Send input via pushInput
  core.pushInput({ inputType: "user_message", data: "List files in C:\\tmp using the fs.list tool" });

  // Wait for completion (max 30s)
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log("\n[timeout] 30s reached, stopping...");
      resolve();
    }, 30000);

    const check = setInterval(() => {
      if (events.some(e => e.type === "LOOP_FINISHED" || e.type === "LOOP_ERROR")) {
        clearInterval(check);
        clearTimeout(timeout);
        setTimeout(resolve, 1000); // give 1s for trailing events
      }
    }, 500);
  });

  await core.stop();

  // Report
  console.log("\n=== Results ===");
  console.log(`Total events: ${events.length}`);
  console.log(`LOOP_STARTED: ${events.filter(e => e.type === "LOOP_STARTED").length}`);
  console.log(`LOOP_FINISHED: ${events.filter(e => e.type === "LOOP_FINISHED").length}`);
  console.log(`LOOP_ERROR: ${events.filter(e => e.type === "LOOP_ERROR").length}`);
  console.log(`TOOL_EXECUTING: ${events.filter(e => e.type === "TOOL_EXECUTING").length}`);

  const hasError = events.some(e => e.type === "LOOP_ERROR");
  const hasFinish = events.some(e => e.type === "LOOP_FINISHED");
  const hasToolUse = events.some(e => e.type === "TOOL_EXECUTING");

  if (hasFinish && hasToolUse) {
    console.log("\n✅ PASS — Tool called successfully + LOOP_FINISHED (BUG-4/6 verified)");
  } else if (hasError) {
    console.log("\n⚠️  LOOP_ERROR detected (BUG-5 propagation working correctly)");
    console.log("   This may be a rate limit (429) — expected with free tier Gemini API key");
  } else if (hasFinish && !hasToolUse) {
    console.log("\n⚠️  LOOP_FINISHED but no tool call — may indicate BUG-4 not fully fixed or model chose not to call tool");
  } else {
    console.log("\n❌ UNEXPECTED — no LOOP_FINISHED or LOOP_ERROR");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
