# @openstarry/runner

CLI application for running OpenStarry agents. Supports foreground mode, daemon mode, and plugin scaffolding.

## Installation

```bash
pnpm add @openstarry/runner
```

## Usage

### Quick Start

```bash
# Start agent with default config
openstarry

# Start with custom config
openstarry start --config ./my-agent.json

# Initialize OpenStarry system directory
openstarry init

# Show version
openstarry version
```

### Commands

#### `start` (default)

Start an agent in foreground mode (REPL).

```bash
openstarry start [options]

Options:
  --config <path>   Path to agent config file (default: ~/.openstarry/agents/default-agent.json)
  --verbose         Show detailed output
```

#### `daemon start`

Start an agent in background daemon mode (persistent, IPC-enabled).

```bash
openstarry daemon start [options]

Options:
  --config <path>   Path to agent config file
  --name <name>     Daemon name (default: derived from config filename)
  --verbose         Show detailed output
```

#### `daemon stop`

Stop a running daemon.

```bash
openstarry daemon stop <name>
```

#### `attach`

Attach to a running daemon session (interactive REPL).

```bash
openstarry attach <daemon-name>
```

#### `ps`

List all running agents.

```bash
openstarry ps
```

#### `init`

Initialize OpenStarry system directory (`~/.openstarry/`).

```bash
openstarry init [--force]

Options:
  --force   Re-initialize even if already initialized
```

#### `create-plugin`

Scaffold a new OpenStarry plugin package.

```bash
openstarry create-plugin

# Interactive prompts:
# - Plugin name
# - Description
# - Author
# - Plugin type (tool/provider/listener/ui/guide)
```

#### `plugin install`

Install plugins from the official catalog.

```bash
openstarry plugin install <name>     # Install a single plugin
openstarry plugin install --all      # Install all 15 official plugins
openstarry plugin install --force    # Reinstall even if already installed

Options:
  --all       Install all official plugins
  --force     Reinstall even if already installed
  --verbose   Show detailed output
```

#### `plugin uninstall`

Remove an installed plugin.

```bash
openstarry plugin uninstall <name>
```

#### `plugin list`

List installed or available plugins.

```bash
openstarry plugin list               # Show installed plugins
openstarry plugin list --all         # Show all catalog plugins (installed/available)
```

#### `plugin search`

Search the plugin catalog by keyword.

```bash
openstarry plugin search <query>     # Search by name, description, or tags
```

#### `plugin info`

Show details about a specific plugin.

```bash
openstarry plugin info <name>        # Show version, aggregates, description, status
```

#### `plugin sync`

Sync plugins from a source repository to `~/.openstarry/plugins/installed/`.

```bash
openstarry plugin sync <source-directory>

Options:
  --dry-run   Preview changes without copying
```

## Directory Structure

Runner creates `~/.openstarry/` on first run:

```
~/.openstarry/
├── config.json              # System configuration
├── agents/
│   └── default-agent.json   # Default agent configuration
├── plugins/
│   └── installed/           # Third-party plugins directory
├── pids/                    # Daemon PID files
├── logs/                    # Daemon log files
├── sockets/                 # Daemon IPC sockets
├── sessions/                # Session persistence
└── history/                 # Input history
```

## Bootstrap Logic

Runner automatically initializes `~/.openstarry/` if it doesn't exist:

1. Creates directory structure
2. Writes default system config (`config.json`)
3. Writes default agent config (`agents/default-agent.json`)

Default agent includes:
- **Provider**: Gemini OAuth (gemini-2.0-flash)
- **Tools**: fs.read, fs.write, fs.list, fs.mkdir, fs.delete
- **Plugins**: provider-gemini-oauth, standard-function-fs, standard-function-stdio, guide-character-init

## Plugin Resolution

Runner resolves plugins in the following order:

1. **Absolute path** — `/path/to/plugin.js`
2. **Relative path** — `./plugins/my-plugin.js`
3. **System directory** — `~/.openstarry/plugins/installed/@openstarry-plugin/my-plugin`
4. **Package name** — `@openstarry-plugin/my-plugin` (resolved via Node.js module resolution)

## Daemon Mode

### Architecture

- **PID file** — `~/.openstarry/pids/<name>.pid`
- **Log file** — `~/.openstarry/logs/<name>.log`
- **IPC socket** — `~/.openstarry/sockets/<name>.sock` (Unix domain socket)
- **Session persistence** — `~/.openstarry/sessions/<name>-<sessionId>.json`

### IPC Protocol

Daemon exposes an IPC server (Unix domain socket) for:

- **pushInput** — Send input to agent
- **attach** — Create interactive session
- **detach** — Disconnect from session
- **getStatus** — Query daemon status
- **stop** — Graceful shutdown

### Event Forwarding

Daemon forwards EventBus events to attached clients via IPC:

- `MESSAGE_ASSISTANT` — LLM response
- `TOOL_EXECUTING` — Tool execution start
- `TOOL_RESULT` — Tool execution result
- `MESSAGE_SYSTEM` — System messages

## Configuration

### System Config (`~/.openstarry/config.json`)

```json
{
  "version": "0.1.0-alpha",
  "pluginSearchPaths": ["~/.openstarry/plugins/installed"],
  "defaultAgent": "default-agent"
}
```

### Agent Config (`~/.openstarry/agents/default-agent.json`)

```json
{
  "identity": {
    "id": "openstarry-agent",
    "name": "OpenStarry Agent",
    "version": "0.1.0-alpha"
  },
  "cognition": {
    "provider": "gemini-oauth",
    "model": "gemini-2.0-flash",
    "maxToolRounds": 10
  },
  "capabilities": {
    "tools": ["fs.read", "fs.write"],
    "allowedPaths": ["."]
  },
  "plugins": [
    { "name": "@openstarry-plugin/provider-gemini-oauth" },
    { "name": "@openstarry-plugin/standard-function-fs" }
  ]
}
```

## Development

```bash
# Build
pnpm build

# Run locally
node dist/bin.js --config ./agent.json
```

## License

MIT
