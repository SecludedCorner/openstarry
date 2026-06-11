# OpenStarry Agent Configurations

All configuration files are placed in this directory for easy management.

## Available Configurations

| File | Description | Plugins | Use Case |
|------|-------------|---------|----------|
| `basic-agent.json` | Minimal CLI agent | stdio, fs, guide | Basic CLI interaction with filesystem tools |
| `websocket-agent.json` | Headless WebSocket agent | fs, guide, transport-websocket | API/programmatic access, no CLI |
| `web-agent.json` | Browser-based agent | stdio, fs, guide, transport-websocket, web-ui | Web browser interaction with chat UI |
| `tui-agent.json` | Terminal dashboard agent | stdio, fs, guide, tui-dashboard | Rich terminal UI with layout panels |
| `mcp-agent.json` | MCP-enabled agent | stdio, fs, guide, mcp-server | Expose tools via Model Context Protocol |
| `full-agent.json` | All features enabled | stdio, fs, skill, guide, websocket, web-ui, devtools | Development and demo |

## Usage

```bash
# From the openstarry root directory:
node apps/runner/dist/bin.js --config ./configs/basic-agent.json

# With debug logging:
LOG_LEVEL=debug node apps/runner/dist/bin.js --config ./configs/web-agent.json
```

## Configuration Structure

```json
{
  "identity":     { "id", "name", "description", "version" },
  "cognition":    { "provider", "model", "temperature", "maxTokens", "maxToolRounds" },
  "capabilities": { "tools": [...], "allowedPaths": [...] },
  "policy":       { "maxConcurrentTools", "toolTimeout" },
  "memory":       { "slidingWindowSize" },
  "plugins":      [ { "name": "...", "config": { ... } } ],
  "guide":        "default-guide"
}
```

## Plugin Reference

| Plugin | Package | Config Keys |
|--------|---------|-------------|
| Gemini OAuth | `@openstarry-plugin/provider-gemini-oauth` | (none, uses OAuth flow) |
| Filesystem Tools | `@openstarry-plugin/standard-function-fs` | (none) |
| CLI I/O | `@openstarry-plugin/standard-function-stdio` | (none) |
| Skill Loader | `@openstarry-plugin/standard-function-skill` | `skillPath` |
| Character Guide | `@openstarry-plugin/guide-character-init` | (none) |
| WebSocket Transport | `@openstarry-plugin/transport-websocket` | `port`, `host`, `path`, `auth`, `healthCheck` |
| Web UI | `@openstarry-plugin/web-ui` | `port`, `host`, `websocketUrl`, `title` |
| TUI Dashboard | `@openstarry-plugin/tui-dashboard` | `theme`, `showToolCalls` |
| MCP Server | `@openstarry-plugin/mcp-server` | `transport` |
| DevTools | `@openstarry-plugin/devtools` | `enableSlashCommands`, `enableMetrics` |
| HTTP Static | `@openstarry-plugin/http-static` | `port`, `host`, `staticDir`, `indexFile` |
| Workflow Engine | `@openstarry-plugin/workflow-engine` | (see workflow-engine README) |

## WebSocket Auth Configuration

`transport-websocket` supports token-based authentication:

```json
{
  "name": "@openstarry-plugin/transport-websocket",
  "config": {
    "auth": {
      "enabled": true,
      "token": "your-secret-token",
      "allowedOrigins": ["http://localhost:8081"],
      "trustedProxies": ["127.0.0.1"]
    }
  }
}
```

- `token`: Static token for authentication (also reads `OPENSTARRY_WS_TOKEN` env var)
- `allowedOrigins`: CORS whitelist (`["*"]` to allow all)
- `trustedProxies`: IPs trusted for X-Forwarded-For header

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Log level: `debug`, `info`, `warn`, `error` | `info` |
| `LOG_FORMAT` | Output format: `text`, `json` | `text` |
| `OPENSTARRY_WS_TOKEN` | WebSocket auth token (fallback) | (none) |

## Quick Test Guide

### 1. Build first
```bash
cd /path/to/openstarry && pnpm build
cd /path/to/openstarry_plugin && pnpm build
```

### 2. Run tests (no LLM needed)
```bash
cd /path/to/openstarry && pnpm test          # 1132 tests
cd /path/to/openstarry && pnpm test:purity    # Microkernel purity check
```

### 3. Start an agent
```bash
# Basic CLI (needs Gemini OAuth)
node apps/runner/dist/bin.js --config ./configs/basic-agent.json

# Web UI (open http://localhost:8081 in browser)
node apps/runner/dist/bin.js --config ./configs/web-agent.json

# Daemon mode
node apps/runner/dist/bin.js daemon start --config ./configs/basic-agent.json
node apps/runner/dist/bin.js ps
node apps/runner/dist/bin.js attach
node apps/runner/dist/bin.js daemon stop
```

### 4. CLI Slash Commands (inside running agent)
| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/reset` | Reset conversation history |
| `/quit` | Exit the agent |
| `/provider login gemini` | Login to Gemini OAuth |
| `/provider status` | Show provider login status |
