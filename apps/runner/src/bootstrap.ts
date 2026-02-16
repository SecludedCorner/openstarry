/**
 * Bootstrap — First-run initialization for OpenStarry system.
 *
 * Creates ~/.openstarry/ directory structure and default configuration
 * if they don't exist.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { IAgentConfig } from "@openstarry/sdk";

// ─── Paths ───

export const OPENSTARRY_HOME = join(homedir(), ".openstarry");
export const AGENTS_DIR = join(OPENSTARRY_HOME, "agents");
export const PLUGINS_DIR = join(OPENSTARRY_HOME, "plugins");
export const PIDS_DIR = join(OPENSTARRY_HOME, "pids");
export const LOGS_DIR = join(OPENSTARRY_HOME, "logs");
export const SOCKETS_DIR = join(OPENSTARRY_HOME, "sockets");
export const SESSIONS_DIR = join(OPENSTARRY_HOME, "sessions");
export const HISTORY_DIR = join(OPENSTARRY_HOME, "history");
export const DEFAULT_AGENT_PATH = join(AGENTS_DIR, "default-agent.json");
export const SYSTEM_CONFIG_PATH = join(OPENSTARRY_HOME, "config.json");

// ─── Default Configurations ───

export interface SystemConfig {
  version: string;
  pluginSearchPaths: string[];
  defaultAgent: string;
}

function getDefaultSystemConfig(): SystemConfig {
  return {
    version: "0.1.0-alpha",
    pluginSearchPaths: [
      join(PLUGINS_DIR, "installed"),
    ],
    defaultAgent: "default-agent",
  };
}

function getDefaultAgentConfig(): IAgentConfig {
  return {
    identity: {
      id: "openstarry-agent",
      name: "OpenStarry Agent",
      description: "Local AI assistant powered by Gemini",
      version: "0.1.0-alpha",
    },
    cognition: {
      provider: "",
      model: "",
      temperature: 0.7,
      maxTokens: 8192,
      maxToolRounds: 10,
    },
    capabilities: {
      tools: ["fs.read", "fs.write", "fs.list", "fs.mkdir", "fs.delete"],
      allowedPaths: [process.cwd()],
    },
    policy: {
      maxConcurrentTools: 1,
      toolTimeout: 30000,
    },
    memory: {
      slidingWindowSize: 5,
    },
    plugins: [
      { name: "@openstarry-plugin/provider-gemini-oauth" },
      { name: "@openstarry-plugin/provider-gemini" },
      { name: "@openstarry-plugin/provider-claude" },
      { name: "@openstarry-plugin/provider-chatgpt" },
      { name: "@openstarry-plugin/provider-local-llama" },
      { name: "@openstarry-plugin/provider-lmstudio" },
      { name: "@openstarry-plugin/standard-model-selector" },
      { name: "@openstarry-plugin/standard-core-commands" },
      { name: "@openstarry-plugin/standard-function-fs" },
      { name: "@openstarry-plugin/standard-function-stdio" },
      { name: "@openstarry-plugin/guide-character-init" },
    ],
    guide: "default-guide",
  };
}

// ─── Bootstrap Logic ───

export interface BootstrapResult {
  isFirstRun: boolean;
  configPath: string;
  openstarryHome: string;
}

/**
 * Initialize OpenStarry system directory structure if needed.
 *
 * Creates:
 *   ~/.openstarry/
 *   ├── config.json              # System configuration
 *   ├── agents/
 *   │   └── default-agent.json   # Default agent configuration
 *   ├── plugins/
 *   │   └── installed/           # Third-party plugins directory
 *   ├── pids/                    # Daemon PID files
 *   ├── logs/                    # Daemon log files
 *   ├── sockets/                 # Daemon IPC sockets
 *   ├── sessions/                # Session persistence
 *   └── history/                 # Input history
 *
 * @returns Bootstrap result with paths and first-run status
 */
export async function bootstrap(): Promise<BootstrapResult> {
  const isFirstRun = !existsSync(DEFAULT_AGENT_PATH);

  if (isFirstRun) {
    console.error("[bootstrap] First run detected. Initializing ~/.openstarry/...");

    // Create directory structure
    await mkdir(AGENTS_DIR, { recursive: true });
    await mkdir(join(PLUGINS_DIR, "installed"), { recursive: true });
    await mkdir(PIDS_DIR, { recursive: true });
    await mkdir(LOGS_DIR, { recursive: true });
    await mkdir(SOCKETS_DIR, { recursive: true });
    await mkdir(SESSIONS_DIR, { recursive: true });
    await mkdir(HISTORY_DIR, { recursive: true });

    // Write system config
    const systemConfig = getDefaultSystemConfig();
    await writeFile(
      SYSTEM_CONFIG_PATH,
      JSON.stringify(systemConfig, null, 2),
      "utf-8"
    );

    // Write default agent config
    const agentConfig = getDefaultAgentConfig();
    await writeFile(
      DEFAULT_AGENT_PATH,
      JSON.stringify(agentConfig, null, 2),
      "utf-8"
    );

    console.error("[bootstrap] Created ~/.openstarry/ with default configuration.");
    console.error(`[bootstrap]   - System config: ${SYSTEM_CONFIG_PATH}`);
    console.error(`[bootstrap]   - Default agent: ${DEFAULT_AGENT_PATH}`);
  }

  return {
    isFirstRun,
    configPath: DEFAULT_AGENT_PATH,
    openstarryHome: OPENSTARRY_HOME,
  };
}

/**
 * Check if system has been initialized.
 */
export function isInitialized(): boolean {
  return existsSync(DEFAULT_AGENT_PATH);
}

/**
 * Get the path to a named agent configuration.
 */
export function getAgentConfigPath(agentName: string): string {
  return join(AGENTS_DIR, `${agentName}.json`);
}
