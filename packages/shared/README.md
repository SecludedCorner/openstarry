# @openstarry/shared

Shared utilities for OpenStarry core and plugins. Logging, validation, ID generation.

## Installation

```bash
pnpm add @openstarry/shared
```

## Exports

### Logger

Structured logger with JSON output support and log level filtering.

```typescript
import { createLogger } from "@openstarry/shared";

const logger = createLogger("MyModule");

logger.info("Agent started", { agentId: "my-agent" });
logger.error("Tool failed", { toolId: "fs:read", error: "File not found" });
logger.debug("Processing input", { input: "Hello" });
logger.warn("Rate limit approaching", { remaining: 10 });
```

#### Features

- **JSON-structured output** — Set `LOG_FORMAT=json` for machine-readable logs
- **Log level filtering** — Set `LOG_LEVEL=debug|info|warn|error` (default: `info`)
- **Context fields** — `agentId`, `traceId`, `sessionId` for observability
- **Child loggers** — Inherit parent context and prefix

#### Environment Variables

- `LOG_LEVEL` — Minimum log level (debug, info, warn, error). Default: `info`
- `LOG_FORMAT` — Output format (`json` or human-readable). Default: human-readable

#### Child Loggers

```typescript
const parent = createLogger("Parent");
const child = parent.child("Child"); // Module name: "Parent:Child"

parent.setContext({ agentId: "agent-1", traceId: "trace-123" });
child.info("Child log"); // Inherits agentId and traceId
```

#### Performance Timing

```typescript
const logger = createLogger("Benchmark");

const stopTimer = logger.time("operation");
// ... do work
const durationMs = stopTimer(); // Logs: "operation completed { durationMs: 123.45 }"
```

### UUID Generator

Generates RFC 4122 v4 UUIDs (random).

```typescript
import { generateId } from "@openstarry/shared";

const id = generateId(); // "a3f2c4b8-1234-4a5c-8d6e-9f8b7a6c5d4e"
```

### Validation Helpers

Zod-based validation utilities.

```typescript
import { validateInput, formatZodError, zodToJsonSchema } from "@openstarry/shared";
import { z } from "zod";

const schema = z.object({
  name: z.string(),
  age: z.number().min(0),
});

const result = validateInput(schema, { name: "Alice", age: 30 });

if (!result.success) {
  console.error(formatZodError(result.error));
} else {
  console.log(result.data); // { name: "Alice", age: 30 }
}

// Convert Zod schema to JSON Schema (for tool parameters)
const jsonSchema = zodToJsonSchema(schema);
```

### Agent Config Schema

Zod schema for validating `IAgentConfig`.

```typescript
import { AgentConfigSchema } from "@openstarry/shared";
import type { ValidatedAgentConfig } from "@openstarry/shared";

const config: ValidatedAgentConfig = AgentConfigSchema.parse({
  identity: { id: "agent-1", name: "My Agent", version: "1.0.0" },
  cognition: { provider: "gemini-oauth", model: "gemini-2.0-flash" },
  capabilities: { tools: [], allowedPaths: [] },
  plugins: [],
});
```

### Event Constants

Re-exports `AgentEventType` from SDK for convenience.

```typescript
import { AgentEventType } from "@openstarry/shared";

bus.emit({
  type: AgentEventType.AGENT_STARTED,
  timestamp: Date.now(),
});
```

## Development

```bash
# Build
pnpm build

# Run tests
pnpm test
```

## License

MIT
