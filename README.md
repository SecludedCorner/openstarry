# OpenStarry

A local AI Agent framework — microkernel + plugin-driven. Get your first AI Agent running in 3 minutes.

Version: **v0.22.0-beta** | Tests: **1451 tests** | Plugins: **22**

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
    ├── provider-*             # LLM Providers (6 providers)
    ├── transport-*            # Transport layer
    ├── web-ui                 # Browser interface
    └── ...                    # 22 plugins total
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

OpenStarry supports 6 LLM providers out of the box. All configs load all providers by default — just log in to the one you have.

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

> All configurations load all 6 providers. Change `cognition.provider` and `cognition.model` to switch providers.

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

| Aggregate | Interface | Role |
|-----------|-----------|------|
| Form (色) | `IUI` | User interface rendering |
| Sensation (受) | `IListener` | Event listeners and transports |
| Perception (想) | `IProvider` | LLM service providers |
| Formation (行) | `ITool` | Executable tools and actions |
| Consciousness (識) | `IGuide` | System prompts and guidance |

The **microkernel** core stays minimal — all features live in plugins. Plugins communicate with the core via the `pushInput()` pattern, never through direct API calls.

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture Overview](./docs/EN/architecture.md) | Five Aggregates philosophy, microkernel design, event-driven flow |
| [Plugin Overview](./docs/EN/plugins.md) | All 19 plugins categorized and explained |
| [Configuration Format](./docs/EN/configuration.md) | agent.json structure, plugin resolution order, environment variables |
| [Development Guide](./docs/EN/development.md) | Creating new plugins, test commands, building |
| [CLI Commands](./docs/EN/cli.md) | CLI command reference, slash commands |

## License

MIT
