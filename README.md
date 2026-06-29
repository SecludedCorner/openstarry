# OpenStarry

A local AI Agent framework — microkernel + plugin-driven. Get your first AI Agent running in 3 minutes.

Version: **v0.59.8-alpha** | Tests: **3393 passed / 0 failed** | Plugins: **48** | License: **Apache-2.0**

[繁體中文](./README_TW.md)

## Requirements

- Node.js >= 20.0.0
- pnpm >= 9.0.0

## Project Structure

```
parent_directory/
├── openstarry/                ← Core framework (you are here)
│   ├── packages/sdk/          # Type contracts (interfaces, events, errors)
│   ├── packages/core/         # Agent core (EventBus, ExecutionLoop)
│   ├── packages/shared/       # Shared utilities
│   ├── apps/runner/           # CLI launcher
│   └── configs/               # Preset configuration examples
│
└── openstarry_plugin/         ← Plugin ecosystem (sibling directory)
    ├── standard-function-*    # Standard tools
    ├── provider-*             # LLM Providers (8 providers)
    ├── transport-*            # Transport layer
    ├── web-ui                 # Browser interface
    └── ...                    # 48 loadable plugins (+1 shared types lib)
```

> `pnpm-workspace.yaml` includes `../openstarry_plugin/*` in the workspace — install, build, and test all at once.

## Quick Start

### Installation

```bash
cd openstarry
pnpm install
pnpm build
```

### Run

```bash
node apps/runner/dist/bin.js --config ./configs/basic-agent.json
```

On first run, `~/.openstarry/` will be created automatically. After startup, set up a provider (see [Provider Setup](#provider-setup) below), then start chatting:

```
> Read the contents of package.json
[tool] Calling: fs.read
[result] { "name": "openstarry", ... }
```

## Provider Setup

OpenStarry ships 8 provider plugins. The six most common setups are shown below. Preloaded providers vary by config — `basic-agent.json` preloads 6 (4 cloud + 2 local); most other presets preload 5 (all but `provider-lmstudio`). Add any missing provider to the config's `plugins` list, then log in to the one you have.

### Option A: Gemini (API Key) — Easiest

Get a free API key from [Google AI Studio](https://aistudio.google.com/app/apikey), then:

```
> /provider login gemini <YOUR_API_KEY>
```

Set your config's `cognition` to:
```json
"cognition": {
  "provider": "gemini",
  "model": "gemini-2.0-flash"
}
```

### Option B: Claude (Anthropic)

Get an API key from [Anthropic Console](https://console.anthropic.com/), then:

```
> /provider login claude <YOUR_API_KEY>
```

Config:
```json
"cognition": {
  "provider": "claude",
  "model": "claude-sonnet-4-20250514"
}
```

Available models: `claude-sonnet-4-20250514`, `claude-opus-4-20250514`, `claude-haiku-4-5-20251001`

### Option C: ChatGPT (OpenAI)

Get an API key from [OpenAI Platform](https://platform.openai.com/api-keys), then:

```
> /provider login chatgpt <YOUR_API_KEY>
```

Config:
```json
"cognition": {
  "provider": "chatgpt",
  "model": "gpt-4o"
}
```

Available models: `gpt-4o`, `gpt-4o-mini`, `o3-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`

### Option D: LM Studio (Local Inference)

If you have [LM Studio](https://lmstudio.ai/) running locally:

```
> /provider login lmstudio
```

The plugin auto-detects models from LM Studio's `/v1/models` endpoint. If LM Studio is on a custom URL:

```
> /provider login lmstudio http://192.168.1.100:1234/v1
```

Then select a model:
```
> /provider model llama-3.2-1b-instruct
```

Config:
```json
"cognition": {
  "provider": "lmstudio",
  "model": "llama-3.2-1b-instruct"
}
```

> **Tip**: Run `/provider login lmstudio` to see all available models loaded in LM Studio.
>
> **Note**: `provider-lmstudio` is preloaded only by `basic-agent.json` and `basic-agent-lmstudio-auto.json` — add it to the `plugins` list of other configs before logging in.

### Option E: Ollama (Local LLM)

Install and run [Ollama](https://ollama.ai/), then:

```
> /provider login ollama
```

If Ollama is on a non-default host:
```
> /provider login ollama http://your-host:11434
```

Config:
```json
"cognition": {
  "provider": "ollama",
  "model": "llama3"
}
```

> Models are auto-detected from your Ollama instance. Use `/ollama refresh` to re-scan after pulling new models.

### Option F: Gemini OAuth (Google Code Assist)

For Google Cloud users with OAuth credentials:

```
> /provider login gemini-oauth <CLIENT_ID> <CLIENT_SECRET>
```

Your browser will open a Google OAuth page. This provider uses the Code Assist endpoint and supports auto-provisioned projects.

### Provider Management Commands

```
/provider status                    — Show all provider status
/provider login <provider> [args]   — Configure a provider
/provider logout <provider>         — Clear credentials (keep config)
/provider remove <provider>         — Remove all credentials
```

## More Demos

### Browser Web UI

```bash
node apps/runner/dist/bin.js --config ./configs/web-agent.json
```

After startup, open your browser:

- **Web UI**: `http://localhost:8081`
- **WebSocket**: `ws://localhost:8080/ws`

Chat with the Agent directly in your browser with streaming responses.

### Background Daemon Mode

```bash
# Start in background
node apps/runner/dist/bin.js daemon start --config ./configs/basic-agent.json

# List running agents
node apps/runner/dist/bin.js ps

# Attach to a background agent to continue chatting
node apps/runner/dist/bin.js attach

# Stop
node apps/runner/dist/bin.js daemon stop
```

### Multi-Agent Coordination (Phase 6)

OpenStarry agents can spawn child agents and delegate cognition across a real process tree.

**Proven end-to-end** (see [Tenets Fulfillment Ledger](https://github.com/SecludedCorner/openstarry_doc/blob/main/TENETS_FULFILLMENT.md), Tenet #10):
- **agent-ask** plugin exposes the cognition loop as a delegable tool, routed over **MCP** (mcp-server + mcp-client): one external call traverses three agent processes (parent → middle → grandchild, each running its full cognition loop) and returns through a single endpoint in <2s (`fractal-depth3.e2e.test.ts`).
- **Process Tree** is real: root self-registration, child spawning with tree edges, out-of-scope denial (SEC-003), and parent-death orphan reaping are all covered by e2e tests (`daemon-process-tree.e2e.test.ts`).
- **Graceful shutdown**: parent shutdown cascades SIGTERM to spawned children.

Try it: `configs/phase6-agent.json` boots the full MCP delegation stack (smoke-tested).

**Honest boundary** (per the ledger's explicit non-claims): additional communication subsystems in the codebase — ICommChannel, comm-pipeline, comm-proxy, the openstarry-channel hub, EventBridge — are verification-layer or not wired into the proven path. Treat them as design references, not shipped features. Protocol design notes: [Doc 53](https://github.com/SecludedCorner/openstarry_doc/blob/main/Architecture_Documentation/53_Multi_Agent_Communication_Interface_Spec.md).

## Available Configurations

Preset configurations are in the `configs/` directory:

| Config | Description | Use Case |
|--------|-------------|----------|
| `basic-agent.json` | Minimal CLI agent | Basic chat + file operations |
| `basic-agent-lmstudio-auto.json` | LM Studio auto-connect | Zero-config local inference |
| `web-agent.json` | Browser Web UI | Open `http://localhost:8081` |
| `websocket-agent.json` | WebSocket only (no CLI) | Programmatic API access |
| `tui-agent.json` | Terminal fullscreen dashboard | Visual monitoring |
| `mcp-agent.json` | MCP protocol agent | Integration with Claude Code and other MCP clients |
| `full-agent.json` | All features | Development and demos |

> Preloaded providers vary by config: `basic-agent.json` loads 6; `web/websocket/tui/mcp/full` load 5 (no `provider-lmstudio`); `basic-agent-lmstudio-auto.json` loads 2; `phase6`/`klesha-modulated` load only `provider-claude-cli`. Change `cognition.provider` and `cognition.model` to switch among the loaded providers.

## Provider Auto-Configuration

Instead of running `/provider login` manually each time, you can embed provider credentials directly in the agent config file. The provider plugin reads `config` on startup and auto-configures itself — no interactive login needed.

### Example: LM Studio Auto-Connect

`configs/basic-agent-lmstudio-auto.json` demonstrates this pattern. Start your LM Studio server, then run:

```bash
node apps/runner/dist/bin.js --config ./configs/basic-agent-lmstudio-auto.json
```

The key parts of the config:

```json
{
  "cognition": {
    "provider": "lmstudio",
    "model": "llama-3.2-1b-instruct"
  },
  "plugins": [
    { "name": "@openstarry-plugin/provider-lmstudio", "config": { "baseUrl": "http://127.0.0.1:1234/v1" } }
  ]
}
```

The plugin's `config` object is passed to the plugin factory as `ctx.config`. On startup, the provider reads `baseUrl`, connects to LM Studio, and is immediately ready — no `/provider login` required.

### Supported Config Fields

Each provider plugin accepts the following `config` fields:

| Provider | Config Fields | Example |
|----------|---------------|---------|
| `provider-lmstudio` | `baseUrl` | `{ "baseUrl": "http://127.0.0.1:1234/v1" }` |
| `provider-local-llama` | `hostUrl` | `{ "hostUrl": "http://127.0.0.1:11434" }` |
| `provider-gemini` | `apiKey` | `{ "apiKey": "AIza..." }` |
| `provider-claude` | `apiKey` | `{ "apiKey": "sk-ant-..." }` |
| `provider-chatgpt` | `apiKey`, `baseUrl` | `{ "apiKey": "sk-...", "baseUrl": "https://api.openai.com/v1" }` |
| `provider-gemini-oauth` | `clientId`, `clientSecret`, `projectId` | `{ "clientId": "...", "clientSecret": "..." }` |

> **Note**: Config values are only used if the provider has no existing credentials in SecureStore. Once configured (via config or `/provider login`), credentials are encrypted and persisted in `~/.openstarry/` — subsequent runs use the stored credentials automatically.

## Architecture

OpenStarry follows the **Five Aggregates** philosophy, mapping all plugin capabilities to five fundamental types:

### Plugin Categories

| Engineering Term | Code Value | Description |
|-----------------|------------|-------------|
| **Input/Sensor** | `'rupa'` | Receives external signals — CLI prompts, HTTP requests, WebSocket messages, file watchers |
| **Feedback/Sensing** | `'vedana'` | Evaluates interaction quality — tool outcome sensing, safety check results, confidence gap detection |
| **Model/Cognition** | `'samjna'` | Processes information — LLM backends, context management, cognitive processing strategies |
| **Action/Tool** | `'samskara'` | Executes concrete actions — file operations, shell commands, API calls, code generation |
| **Control/Governance** | `'vijnana'` | Routes decisions — confidence routing, gear arbitration, threshold auditing, agent persona |

### Plugin Criticality Levels

| Level | Behavior on Missing | Example |
|-------|-------------------|---------|
| `required` | Agent refuses to start | Context manager, model selector |
| `optional-degraded` | Agent starts with reduced capability + warning | Loop quality monitor, threshold auditor |
| `optional-no-effect` | Agent starts normally, feature simply absent | Custom sensors, telemetry exporters |

### Five Aggregates Mapping

| Aggregate | Interface | Role |
|-----------|-----------|------|
| Form (色) | `IUI` + `IListener` | Outward form (UI rendering) and sensory input channels |
| Sensation (受) | `IVedana` | Feedback quality signals (dukkha/sukha/upekkha) |
| Perception (想) | `IProvider` | LLM service providers |
| Formation (行) | `ITool` | Executable tools and actions |
| Consciousness (識) | `IGuide` | System prompts and guidance |

> Note: an earlier revision of this table mis-assigned `IListener` to 受 (Sensation). The canonical mapping (corrected at Cycle 02-4, see the doc repo's Deep Dive 14) places listeners under 色 (Form) — a listener is a sense organ, not a feeling.

The **microkernel** core stays minimal — all features live in plugins. Plugins communicate with the core via the `pushInput()` pattern, never through direct API calls.

## Documentation

The full documentation corpus lives in the companion repo **[openstarry_doc](https://github.com/SecludedCorner/openstarry_doc)** — start with its guided reading path:

| Document | Description |
|----------|-------------|
| [Letter to the Future](https://github.com/SecludedCorner/openstarry_doc/blob/main/LETTER_TO_THE_FUTURE.md) | What this project is, why, what it proved, and where it failed — with the honest numbers |
| [Tenets Fulfillment Ledger](https://github.com/SecludedCorner/openstarry_doc/blob/main/TENETS_FULFILLMENT.md) | Per-tenet evidence: how far each of the Ten Tenets is proven by running code |
| [Getting Started](https://github.com/SecludedCorner/openstarry_doc/blob/main/GETTING_STARTED.md) | 10 minutes from config to your first plugin (verified against the real CLI) |
| [Retrospective](https://github.com/SecludedCorner/openstarry_doc/blob/main/RETROSPECTIVE.md) | How a multi-agent dev system inflated its progress by 96%, got caught, and got honest |

## License

Apache-2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
