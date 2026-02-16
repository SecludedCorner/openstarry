/**
 * Attach Command — Attach to a running daemon session.
 *
 * Command: openstarry attach [agent-id] [--session <id>] [--verbose]
 *
 * Phases:
 * 1. Resolve agent ID (positional arg or infer from ./agent.json)
 * 2. Check daemon running (pidManager), auto-start if needed
 * 3. Connect IPC client to daemon socket
 * 4. Call agent.attach RPC → get AttachResult
 * 5. Interactive readline loop (listen for events, send user input)
 * 6. Graceful detach on Ctrl+C or /quit
 */

import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { createInterface } from "node:readline";
import type { ReadLine } from "node:readline";
import type { IAgentConfig } from "@openstarry/sdk";
import type { CliCommand, ParsedArgs } from "./base.js";
import { OPENSTARRY_HOME, HISTORY_DIR } from "../bootstrap.js";
import { pidManager } from "../daemon/pid-manager.js";
import { IPCClientImpl } from "../daemon/ipc-client.js";
import { getDefaultSocketPath } from "../daemon/platform.js";
import type { AttachResult, InputMessage, DetachMessage } from "../daemon/types.js";
import type { OutputEvent, ToolEvent, LoopEvent, ReplayEvent } from "../daemon/attach-types.js";
import { DaemonStartCommand } from "./daemon-start.js";

export class AttachCommand implements CliCommand {
  name = "attach";
  description = "Attach to a running daemon session";

  private client: IPCClientImpl | null = null;
  private sessionId: string | null = null;
  private agentId: string | null = null;
  private verbose = false;
  private historyFile: string | null = null;

  private readonly commands = [
    "/quit",
    "/exit",
    "/session list",
    "/session switch",
    "/session new",
    "/session info",
    "/history",
    "/clear",
    "/help",
  ];

  async execute(args: ParsedArgs): Promise<number> {
    this.verbose = args.flags.verbose === true;

    // Phase 1: Resolve agent ID
    this.agentId = await this.resolveAgentId(args);
    if (!this.agentId) {
      const pidsDir = join(OPENSTARRY_HOME, "pids");
      const running = pidManager.listRunningAgents(pidsDir);
      if (running.length > 1) {
        console.error("Error: Multiple agents running. Specify which one to attach:");
        for (const agent of running) {
          console.error(`  openstarry attach ${agent.agentId}`);
        }
      } else {
        console.error("Error: No running agent found.");
        console.error("Usage: openstarry attach [agent-id] [--session <id>] [--verbose]");
      }
      return 1;
    }

    if (this.verbose) {
      console.error(`[attach] Resolved agent ID: ${this.agentId}`);
    }

    // Phase 2: Check daemon running
    const pidFile = join(OPENSTARRY_HOME, "pids", `${this.agentId}.pid`);
    const socketPath = getDefaultSocketPath(this.agentId, OPENSTARRY_HOME);

    const pid = pidManager.readPid(pidFile);
    const isRunning = pid !== null && pidManager.isProcessRunning(pid);

    if (!isRunning) {
      console.error(`Daemon for agent '${this.agentId}' is not running.`);
      console.error("Starting daemon automatically...");

      // Auto-start daemon
      const startCmd = new DaemonStartCommand();
      const startArgs: ParsedArgs = {
        command: "daemon-start",
        flags: {
          config: args.flags.config ?? "./agent.json",
          "agent-id": this.agentId,
        },
        positional: [],
      };
      const exitCode = await startCmd.execute(startArgs);
      if (exitCode !== 0) {
        console.error("Failed to start daemon.");
        return 1;
      }

      // Wait a moment for daemon to initialize
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Phase 3: Connect IPC client
    this.client = new IPCClientImpl({ socketPath, timeoutMs: 10000 });

    try {
      await this.client.connect();
      if (this.verbose) {
        console.error(`[attach] Connected to daemon socket: ${socketPath}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("EACCES") || msg.includes("Permission denied")) {
        console.error(`Error: Permission denied: ${socketPath}`);
        console.error("The daemon may have been started by a different user.");
      } else if (msg.includes("ENOENT")) {
        console.error(`Error: Socket file not found: ${socketPath}`);
      } else if (msg.includes("ECONNREFUSED")) {
        console.error("Error: Failed to connect to daemon (socket exists but daemon not responding)");
      } else {
        console.error(`Error: Failed to connect to daemon: ${msg}`);
      }
      return 1;
    }

    // Set up connection lost detection
    this.client.on("_close", () => {
      console.error("\n[Connection lost: Daemon process terminated]");
      if (this.sessionId) {
        console.error(`Session '${this.sessionId}' is persisted. Reconnect with:`);
        console.error(`  openstarry attach ${this.agentId} --session ${this.sessionId}`);
      }
      process.exit(0);
    });

    // Phase 4: Call agent.attach RPC
    const attachResult = await this.attachToSession(args.flags.session as string | undefined);
    if (!attachResult) {
      return 1;
    }

    this.sessionId = attachResult.sessionId;

    console.log(`Attached to ${attachResult.agentName} v${attachResult.agentVersion}`);
    console.log(`Session ID: ${attachResult.sessionId} (${attachResult.isNew ? "new" : "existing"})`);
    console.log("Type your message or /quit to exit. Use /help for commands.\n");

    // Phase 4.5: Show provider status on attach
    await this.sendSlashCommand("/provider status");

    // Phase 5: Interactive readline loop
    const exitCode = await this.interactiveLoop();

    // Phase 6: Graceful detach
    await this.detach();

    return exitCode;
  }

  /**
   * Resolve agent ID from positional arg, ./agent.json, or sole running agent.
   */
  private async resolveAgentId(args: ParsedArgs): Promise<string | null> {
    // Check positional argument
    if (args.positional.length > 0) {
      return args.positional[0];
    }

    // Infer from ./agent.json
    const configPath = args.flags.config as string | undefined ?? "./agent.json";
    const resolvedConfigPath = resolve(configPath);

    if (existsSync(resolvedConfigPath)) {
      try {
        const raw = readFileSync(resolvedConfigPath, "utf-8");
        const config = JSON.parse(raw) as IAgentConfig;
        return config.identity.id;
      } catch {
        // Fall through
      }
    }

    // Auto-detect: if exactly one agent is running, use it
    const pidsDir = join(OPENSTARRY_HOME, "pids");
    const running = pidManager.listRunningAgents(pidsDir);
    if (running.length === 1) {
      console.error(`Auto-detected running agent: ${running[0].agentId}`);
      return running[0].agentId;
    }

    return null;
  }

  /**
   * Call agent.attach RPC and subscribe to events.
   */
  private async attachToSession(sessionId?: string): Promise<AttachResult | null> {
    if (!this.client) {
      return null;
    }

    try {
      const result = await this.client.call("agent.attach", {
        sessionId,
      }) as AttachResult;

      // Subscribe to events
      this.client.on("agent.output", (data) => this.handleOutputEvent(data));
      this.client.on("agent.tool", (data) => this.handleToolEvent(data));
      this.client.on("agent.loop", (data) => this.handleLoopEvent(data));
      this.client.on("agent.replay", (data) => this.handleReplayEvent(data));

      return result;
    } catch (err) {
      console.error(`Error: Failed to attach to session: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Interactive readline loop with tab-completion and history.
   */
  private async interactiveLoop(): Promise<number> {
    return new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        completer: this.createCompleter(),
      });

      // Load history
      this.loadHistory(rl).catch((err) => {
        if (this.verbose) {
          console.error(`[attach] Failed to load history: ${err}`);
        }
      });

      rl.setPrompt("> ");
      rl.prompt();

      rl.on("line", async (line) => {
        const trimmed = line.trim();

        // Handle slash commands
        if (trimmed.startsWith("/")) {
          const shouldExit = await this.handleSlashCommand(trimmed, rl);
          if (shouldExit) {
            rl.close();
            resolve(0);
            return;
          }
          rl.prompt();
          return;
        }

        // Handle empty input
        if (trimmed === "") {
          rl.prompt();
          return;
        }

        // Send user input
        await this.sendInput(trimmed);

        rl.prompt();
      });

      rl.on("SIGINT", () => {
        console.log("\nDetaching...");
        rl.close();
        resolve(0);
      });

      rl.on("close", async () => {
        // Save history
        await this.saveHistory(rl);
        resolve(0);
      });
    });
  }

  /**
   * Create tab-completion function.
   */
  private createCompleter(): (line: string) => [string[], string] {
    return (line: string): [string[], string] => {
      if (!line.startsWith("/")) {
        return [[], line];
      }
      const hits = this.commands.filter((cmd) => cmd.startsWith(line));
      return [hits.length ? hits : this.commands, line];
    };
  }

  /**
   * Load input history from file.
   */
  private async loadHistory(rl: ReadLine): Promise<void> {
    if (!this.agentId) return;

    this.historyFile = join(HISTORY_DIR, `${this.agentId}.txt`);

    try {
      if (!existsSync(HISTORY_DIR)) {
        await mkdir(HISTORY_DIR, { recursive: true });
      }

      if (existsSync(this.historyFile)) {
        const raw = await readFile(this.historyFile, "utf-8");
        const history = raw.split("\n").filter(Boolean).slice(-100); // Last 100 commands

        // Populate readline history (access internal history array)
        for (const line of history) {
          (rl as any).history.unshift(line);
        }

        if (this.verbose) {
          console.error(`[attach] Loaded ${history.length} history entries`);
        }
      }
    } catch (err) {
      if (this.verbose) {
        console.error(`[attach] Failed to load history: ${err}`);
      }
    }
  }

  /**
   * Save input history to file.
   */
  private async saveHistory(rl: ReadLine): Promise<void> {
    if (!this.historyFile) return;

    try {
      const history = (rl as any).history.slice(0, 100).join("\n");
      await writeFile(this.historyFile, history, "utf-8");

      if (this.verbose) {
        console.error(`[attach] Saved history to ${this.historyFile}`);
      }
    } catch (err) {
      if (this.verbose) {
        console.error(`[attach] Failed to save history: ${err}`);
      }
    }
  }

  /**
   * Handle slash commands.
   * Returns true if should exit.
   */
  private async handleSlashCommand(cmd: string, rl: ReadLine): Promise<boolean> {
    const parts = cmd.slice(1).split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

    switch (command) {
      case "quit":
      case "exit":
        return true;

      case "session":
        await this.handleSessionCommand(args);
        break;

      case "history":
        await this.handleHistoryCommand(args);
        break;

      case "clear":
        process.stdout.write("\x1Bc"); // ANSI clear screen
        break;

      case "help":
        this.showHelp();
        break;

      default:
        // Forward unrecognized slash commands to daemon
        await this.sendSlashCommand(cmd);
    }

    return false;
  }

  /**
   * Handle /session commands.
   */
  private async handleSessionCommand(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.error("Usage: /session <list|switch|new|info>");
      return;
    }

    const subcommand = args[0];

    switch (subcommand) {
      case "list":
        console.log("Session list command not yet implemented.");
        break;

      case "switch":
        if (args.length < 2) {
          console.error("Usage: /session switch <session-id>");
          return;
        }
        console.log(`Session switch to '${args[1]}' not yet implemented.`);
        break;

      case "new":
        console.log("Session new command not yet implemented.");
        break;

      case "info":
        if (this.sessionId) {
          console.log(`Current session: ${this.sessionId}`);
        } else {
          console.log("No active session.");
        }
        break;

      default:
        console.error(`Unknown session command: ${subcommand}`);
    }
  }

  /**
   * Handle /history command.
   */
  private async handleHistoryCommand(args: string[]): Promise<void> {
    console.log("History display command not yet implemented.");
  }

  /**
   * Show help message.
   */
  private showHelp(): void {
    console.log("\nAttach commands:");
    console.log("  /quit, /exit        — Exit attach mode");
    console.log("  /session list       — List all active sessions");
    console.log("  /session switch <id> — Switch to a different session");
    console.log("  /session new        — Create a new session");
    console.log("  /session info       — Show current session info");
    console.log("  /history [N]        — Display last N messages");
    console.log("  /clear              — Clear screen");
    console.log("  /help               — Show this help message");
    console.log("\nOther slash commands (e.g. /provider, /reset) are forwarded to the agent.");
    console.log();
  }

  /**
   * Send user input to daemon session.
   */
  private async sendInput(input: string): Promise<void> {
    if (!this.client || !this.sessionId) {
      return;
    }

    try {
      const msg: InputMessage = {
        sessionId: this.sessionId,
        inputType: "user_input",
        data: input,
      };
      await this.client.call("agent.input", msg);
    } catch (err) {
      console.error(`Error sending input: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Forward a slash command to daemon session.
   */
  private async sendSlashCommand(cmd: string): Promise<void> {
    if (!this.client || !this.sessionId) {
      return;
    }

    try {
      const msg: InputMessage = {
        sessionId: this.sessionId,
        inputType: "slash_command",
        data: cmd,
      };
      await this.client.call("agent.input", msg);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Detach from session.
   */
  private async detach(): Promise<void> {
    if (!this.client || !this.sessionId) {
      return;
    }

    try {
      const msg: DetachMessage = {
        sessionId: this.sessionId,
      };
      await this.client.call("agent.detach", msg);
    } catch (err) {
      if (this.verbose) {
        console.error(`Detach error: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      this.client.close();
      this.client = null;
    }
  }

  /**
   * Handle agent.output events.
   */
  private handleOutputEvent(data: unknown): void {
    const event = data as OutputEvent;

    if (event.isReasoning && !this.verbose) {
      // Skip reasoning output unless verbose
      return;
    }

    // Print text delta inline (no newline)
    process.stdout.write(event.text);
  }

  /**
   * Handle agent.tool events.
   */
  private handleToolEvent(data: unknown): void {
    if (!this.verbose) {
      return;
    }

    const event = data as ToolEvent;

    switch (event.status) {
      case "started":
        console.error(`\n[tool] Executing: ${event.toolName}`);
        break;
      case "completed":
        console.error(`[tool] Completed: ${event.toolName}`);
        break;
      case "failed":
        console.error(`[tool] Failed: ${event.toolName} — ${event.error}`);
        break;
    }
  }

  /**
   * Handle agent.loop events.
   */
  private handleLoopEvent(data: unknown): void {
    if (!this.verbose) {
      return;
    }

    const event = data as LoopEvent;

    switch (event.phase) {
      case "started":
        console.error(`\n[loop] Started`);
        break;
      case "awaiting_llm":
        console.error(`[loop] Awaiting LLM...`);
        break;
      case "finished":
        console.error(`[loop] Finished`);
        break;
      case "error":
        console.error(`[loop] Error: ${event.error}`);
        break;
    }
  }

  /**
   * Handle agent.replay events (history replay).
   */
  private handleReplayEvent(data: unknown): void {
    const event = data as ReplayEvent;
    const msg = event.message;

    // Render message based on role
    switch (msg.role) {
      case "user":
        console.log(`\n[You]: ${this.extractText(msg)}`);
        break;
      case "assistant":
        console.log(`\n[Agent]: ${this.extractText(msg)}`);
        break;
      case "system":
        if (this.verbose) {
          console.log(`\n[System]: ${this.extractText(msg)}`);
        }
        break;
    }
  }

  /**
   * Extract text content from message.
   */
  private extractText(msg: any): string {
    return msg.content
      .filter((seg: any) => seg.type === "text")
      .map((seg: any) => seg.text)
      .join("");
  }
}
