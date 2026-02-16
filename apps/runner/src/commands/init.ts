/**
 * Init command - create a new agent configuration interactively.
 */

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IAgentConfig } from "@openstarry/sdk";
import type { CliCommand, ParsedArgs } from "./base.js";
import { Prompter } from "../utils/prompts.js";

export interface InitPromptResult {
  name: string;
  description: string;
  provider: string;
  model: string;
  plugins: string[];
}

export class InitCommand implements CliCommand {
  name = "init";
  description = "Create a new agent configuration interactively";

  async execute(args: ParsedArgs): Promise<number> {
    // 1. Check if agent.json exists
    const targetPath = resolve(process.cwd(), "agent.json");
    if (existsSync(targetPath) && !args.flags.force) {
      console.error(`agent.json already exists at ${targetPath}`);
      console.error(`Use --force to overwrite.`);
      return 1;
    }

    // 2. Interactive prompts
    console.log("Creating a new OpenStarry agent configuration...\n");
    const result = await this.promptUser();

    // 3. Generate config
    const config = this.generateConfig(result);

    // 4. Write to disk
    await writeFile(targetPath, JSON.stringify(config, null, 2), "utf-8");

    console.log(`\nAgent configuration created: ${targetPath}`);
    console.log(`Run 'openstarry start' to launch your agent.`);

    return 0;
  }

  private async promptUser(): Promise<InitPromptResult> {
    const prompter = new Prompter();

    const name = await prompter.ask("Agent name", "MyAgent");
    const description = await prompter.ask("Description", "An OpenStarry AI agent");
    const provider = await prompter.ask("LLM provider", "gemini-oauth");
    const model = await prompter.ask("Model", "gemini-2.0-flash");

    prompter.close();

    return { name, description, provider, model, plugins: [] };
  }

  private generateConfig(result: InitPromptResult): IAgentConfig {
    return {
      identity: {
        id: result.name.toLowerCase().replace(/\s+/g, "-"),
        name: result.name,
        description: result.description,
        version: "0.1.0",
      },
      cognition: {
        provider: result.provider,
        model: result.model,
        temperature: 0.7,
        maxTokens: 8192,
        maxToolRounds: 10,
      },
      capabilities: {
        tools: ["fs.read", "fs.write", "fs.list"],
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
        { name: "@openstarry-plugin/standard-function-fs" },
        { name: "@openstarry-plugin/standard-function-stdio" },
      ],
      guide: "default-guide",
    };
  }
}
