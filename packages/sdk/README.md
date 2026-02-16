# @openstarry/sdk

Type contracts and interfaces for the OpenStarry plugin system. Zero runtime dependencies.

## Architecture

This package defines the **Five Aggregates (五蘊)** — the core abstraction mapping Buddhist philosophy to plugin hooks:

- **IUI (色蘊)** — User interface renderers (Form/Color)
- **IListener (受蘊)** — Event listeners and input processors (Sensation/Feeling)
- **IProvider (想蘊)** — Service providers (LLM, data sources) (Perception/Cognition)
- **ITool (行蘊)** — Executable tools and actions (Mental Formations/Volition)
- **IGuide (識蘊)** — System prompts and guides (Consciousness/Awareness)

## Installation

```bash
pnpm add @openstarry/sdk
```

## Core Interfaces

### Plugin System

- `IPlugin` — Plugin definition (manifest + factory function)
- `IPluginContext` — Context provided to plugins at initialization
- `PluginHooks` — Hooks returned by plugin factory (providers, tools, listeners, ui, guides, commands, dispose)
- `PluginManifest` — Plugin metadata (name, version, sandbox config, integrity signature)

### Five Aggregates

```typescript
import type { IUI, IListener, IProvider, ITool, IGuide } from "@openstarry/sdk";

// 色蘊 (Form) — UI renderers
interface IUI {
  id: string;
  render(): void | Promise<void>;
  start?(): void | Promise<void>;
  stop?(): void | Promise<void>;
}

// 受蘊 (Sensation) — Event listeners
interface IListener {
  id: string;
  setup(ctx: IPluginContext): void | Promise<void>;
  start?(): void | Promise<void>;
  stop?(): void | Promise<void>;
}

// 想蘊 (Perception) — LLM providers
interface IProvider {
  id: string;
  name: string;
  supportedModels?: string[];
  chat(request: ChatRequest): Promise<AsyncIterable<ProviderStreamEvent>>;
}

// 行蘊 (Volition) — Executable tools
interface ITool {
  id: string;
  name: string;
  description: string;
  parameters: ToolJsonSchema;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

// 識蘊 (Consciousness) — System prompts
interface IGuide {
  id: string;
  name: string;
  description?: string;
  getPrompt(context: { messages: Message[] }): string | Promise<string>;
}
```

### Events

- `AgentEventType` — Event type constants (AGENT_STARTED, INPUT_RECEIVED, TOOL_EXECUTING, etc.)
- `AgentEvent` — Event payload structure
- `InputEvent` — Input event format for `ctx.pushInput()`
- `EventBus` — Event bus interface (on, off, emit, onAny, offAny)

### Session Management

- `ISession` — Session interface (id, metadata, conversationHistory, memoryContext)
- `ISessionManager` — Session lifecycle management (create, get, destroy)

### Security & Sandbox

- `SandboxConfig` — Sandbox configuration (memoryLimitMb, cpuTimeoutMs, restartPolicy, allowedPaths)
- `SandboxAuditConfig` — Audit logging configuration (opt-in, structured JSONL output)
- `PkiIntegrity` — Plugin signature format (Ed25519/RSA public key cryptography)
- `PluginCapabilities` — Capability-based access control (allowedProviders whitelist)

### Service Registry

- `IPluginService` — Service interface for cross-plugin dependencies
- `IServiceRegistry` — Service registration and dependency injection

### Errors

All error classes extend `AgentError`:

- `ToolExecutionError` — Tool execution failure
- `ProviderError` — LLM provider failure
- `PluginLoadError` — Plugin loading failure
- `SecurityError` — Security violation
- `SandboxError` — Sandbox isolation failure
- `SessionError` — Session management failure
- `ServiceRegistrationError` — Service registration failure
- `ServiceDependencyError` — Service dependency failure

### Error Codes

```typescript
import { ErrorCode } from "@openstarry/sdk";

ErrorCode.INTERNAL_ERROR
ErrorCode.TOOL_NOT_FOUND
ErrorCode.TOOL_EXECUTION_FAILED
ErrorCode.PROVIDER_NOT_FOUND
ErrorCode.PROVIDER_CALL_FAILED
ErrorCode.PLUGIN_LOAD_FAILED
ErrorCode.SECURITY_VIOLATION
ErrorCode.SANDBOX_ESCAPE
ErrorCode.SESSION_NOT_FOUND
ErrorCode.SERVICE_NOT_FOUND
// ... and more
```

## Key Patterns

### Plugin Factory Pattern

```typescript
import type { IPlugin } from "@openstarry/sdk";

export function createMyPlugin(): IPlugin {
  return {
    manifest: {
      name: "@openstarry-plugin/my-plugin",
      version: "1.0.0",
      sandbox: { enabled: true, memoryLimitMb: 512 },
    },
    async factory(ctx) {
      // Initialize plugin
      const myTool = createMyTool();
      const myListener = createMyListener(ctx.bus);

      return {
        tools: [myTool],
        listeners: [myListener],
        dispose: async () => {
          // Cleanup
        },
      };
    },
  };
}
```

### pushInput Pattern

All external input flows through `ctx.pushInput()`:

```typescript
ctx.pushInput({
  source: "websocket",
  inputType: "user_input",
  data: "Hello, agent!",
});
```

## Development

```bash
# Build types
pnpm build

# Run tests
pnpm test
```

## License

MIT
