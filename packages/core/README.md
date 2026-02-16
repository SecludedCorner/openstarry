# @openstarry/core

Microkernel runtime for the OpenStarry agent framework. Event-driven, plugin-isolated, secure.

## Architecture

The core follows a **microkernel design** — all features live in plugins, the core only provides:

1. **Event-driven execution** — EventBus + EventQueue + ExecutionLoop
2. **Plugin isolation** — Sandbox with worker threads, memory limits, signature verification
3. **State management** — StateManager + ContextManager + SessionManager
4. **Security** — SecurityLayer (path sandboxing) + SafetyMonitor (loop detection)
5. **Five Aggregates registries** — ToolRegistry, ProviderRegistry, ListenerRegistry, UIRegistry, GuideRegistry

## Installation

```bash
pnpm add @openstarry/core
```

## Usage

### Creating an Agent

```typescript
import { createAgentCore } from "@openstarry/core";
import type { IAgentConfig } from "@openstarry/sdk";

const config: IAgentConfig = {
  identity: {
    id: "my-agent",
    name: "My Agent",
    version: "1.0.0",
  },
  cognition: {
    provider: "gemini-oauth",
    model: "gemini-2.0-flash",
    maxToolRounds: 10,
  },
  capabilities: {
    tools: ["fs.read", "fs.write"],
    allowedPaths: [process.cwd()],
  },
  plugins: [
    { name: "@openstarry-plugin/provider-gemini-oauth" },
    { name: "@openstarry-plugin/standard-function-fs" },
  ],
};

const agent = createAgentCore(config);
```

### Loading Plugins

```typescript
import { createMyPlugin } from "@openstarry-plugin/my-plugin";

await agent.loadPlugin(createMyPlugin());
```

### Starting the Agent

```typescript
await agent.start(); // Starts ExecutionLoop, listeners, UIs
```

### Processing Input

```typescript
// Recommended: pushInput (event-driven)
agent.pushInput({
  source: "cli",
  inputType: "user_input",
  data: "Hello, agent!",
});

// Legacy: processInput (convenience wrapper)
agent.processInput("Hello, agent!", "cli");
```

### Slash Commands

Slash commands bypass the LLM loop (fast path):

```typescript
agent.processInput("/help");    // List commands
agent.processInput("/reset");   // Clear conversation
agent.processInput("/metrics"); // Show metrics snapshot
agent.processInput("/quit");    // Stop agent
```

### Stopping the Agent

```typescript
await agent.stop(); // Stops ExecutionLoop, listeners, UIs, disposes plugins
```

## Core Components

### AgentCore

Main orchestrator. Wires all subsystems together.

```typescript
export interface AgentCore {
  readonly bus: EventBus;
  readonly queue: EventQueue;
  readonly sessionManager: ISessionManager;
  readonly toolRegistry: ToolRegistry;
  readonly providerRegistry: ProviderRegistry;
  readonly security: SecurityLayer;
  readonly metrics: MetricsCollector;

  loadPlugin(plugin: IPlugin): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  pushInput(inputEvent: InputEvent): void;
  processInput(input: string, source?: string): void;
  reset(): void;
}
```

### EventBus

Pub/sub event bus for agent-wide events.

```typescript
import { createEventBus } from "@openstarry/core";

const bus = createEventBus();

bus.on(AgentEventType.TOOL_EXECUTING, (event) => {
  console.log("Tool executing:", event.payload.tool);
});

bus.emit({
  type: AgentEventType.TOOL_EXECUTING,
  timestamp: Date.now(),
  payload: { tool: "fs:read", args: {} },
});
```

### EventQueue

FIFO queue for input events. ExecutionLoop pulls from this queue.

```typescript
import { createEventQueue } from "@openstarry/core";

const queue = createEventQueue();

queue.push({
  type: AgentEventType.INPUT_RECEIVED,
  timestamp: Date.now(),
  payload: { source: "cli", inputType: "user_input", data: "Hello" },
});

const event = queue.shift(); // null if empty
```

### ExecutionLoop

Event-driven LLM loop. Pulls from EventQueue, routes to LLM, executes tools, handles tool results.

```typescript
import { createExecutionLoop } from "@openstarry/core";

const loop = createExecutionLoop({
  bus,
  queue,
  sessionManager,
  contextManager,
  toolRegistry,
  security,
  safetyMonitor,
  providerResolver: () => myProvider,
  model: "gemini-2.0-flash",
  maxToolRounds: 10,
  slidingWindowSize: 5,
  workingDirectory: process.cwd(),
});

loop.start();
// ... loop.stop();
```

### PluginSandboxManager

Runs plugins in isolated worker threads with memory limits, CPU timeouts, signature verification, and restart policies.

```typescript
import { createPluginSandboxManager } from "@openstarry/core";

const sandboxManager = createPluginSandboxManager({
  bus,
  pushInput,
  sessions: sessionManager,
  tools: { list: () => tools, get: (id) => tools.find(t => t.id === id) },
  guides: { list: () => guides },
  providers: { list: () => providers, get: (id) => providers.find(p => p.id === id) },
  services: serviceRegistry,
});
```

### StateManager & ContextManager

- **StateManager**: Stores agent state (conversation history, context variables)
- **ContextManager**: Manages sliding window context for LLM (max N recent messages)

```typescript
import { createStateManager, createContextManager } from "@openstarry/core";

const stateManager = createStateManager();
const contextManager = createContextManager();
```

### SessionManager

Session lifecycle management (create, get, destroy sessions).

```typescript
import { createSessionManager } from "@openstarry/core";

const sessionManager = createSessionManager(bus);

const session = sessionManager.create({
  source: "websocket",
  metadata: { sessionId: "ws-123" },
});

const existing = sessionManager.get("ws-123");
sessionManager.destroy("ws-123");
```

### SecurityLayer

Path sandboxing. Validates tool execution paths against allowedPaths.

```typescript
import { createSecurityLayer } from "@openstarry/core";

const security = createSecurityLayer([process.cwd()], sessionResolver);

// Throws SecurityError if path is outside allowedPaths
security.checkPath("/tmp/file.txt", "ws-123");
```

### SafetyMonitor

Loop detection (max tool rounds, token usage limits, guardrails).

```typescript
import { createSafetyMonitor } from "@openstarry/core";

const safetyMonitor = createSafetyMonitor({
  maxLoopTicks: 50,
  maxTokenUsage: 0, // Unlimited
});

const check = safetyMonitor.checkLoop();
if (!check.safe) {
  console.error("Safety violation:", check.reason);
}
```

### MetricsCollector

Counters and gauges for observability.

```typescript
import { createMetricsCollector } from "@openstarry/core";

const metrics = createMetricsCollector();

metrics.increment("tool.calls.total");
metrics.set("queue.size", 5);

const snapshot = metrics.getSnapshot();
console.log(snapshot.counters); // { "tool.calls.total": 1 }
console.log(snapshot.gauges);   // { "queue.size": 5 }
```

## Microkernel Purity

Core has **zero plugin references**. All plugins are loaded dynamically via PluginLoader.

Run purity check:

```bash
pnpm test:purity
```

This verifies that `packages/core/src/` contains no imports from `@openstarry-plugin/*`.

## Event Flow

```
1. Input arrives (CLI, websocket, etc.)
   → ctx.pushInput({ source, inputType, data })

2. AgentCore.pushInput()
   → Checks if slash command (fast path)
   → Pushes to EventQueue

3. ExecutionLoop.tick()
   → Pulls from EventQueue
   → Routes to LLM provider
   → LLM returns tool calls
   → Executes tools in parallel (up to maxConcurrentTools)
   → Pushes tool results back to LLM
   → Repeats until LLM returns final text response

4. Events emitted via EventBus:
   - AGENT_STARTED, INPUT_RECEIVED, LLM_REQUEST, LLM_RESPONSE, TOOL_EXECUTING, TOOL_RESULT, MESSAGE_ASSISTANT, etc.
```

## Development

```bash
# Build
pnpm build

# Run tests (82+ tests)
pnpm test

# Check microkernel purity
pnpm test:purity
```

## License

MIT
