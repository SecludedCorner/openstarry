/**
 * CreatePluginCommand - Scaffolds a new OpenStarry plugin package.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CliCommand, ParsedArgs } from "./base.js";
import { Prompter } from "../utils/prompts.js";

/**
 * Plugin type selection (maps to Five Aggregates).
 */
export type PluginType =
  | "tool"      // 行蘊 - ITool only
  | "listener"  // 受蘊 - IListener only
  | "ui"        // 色蘊 - IUI only
  | "provider"  // 想蘊 - IProvider only
  | "guide"     // 識蘊 - IGuide only
  | "full";     // All capabilities

/**
 * Interactive prompt result structure.
 */
export interface CreatePluginPromptResult {
  name: string;
  description: string;
  type: PluginType;
  author?: string;
}

/**
 * Plugin scaffold configuration derived from prompt result.
 */
export interface PluginScaffoldConfig {
  name: string;
  namePascal: string;
  packageName: string;
  description: string;
  author: string;
  year: string;
  capabilities: {
    hasTools: boolean;
    hasListeners: boolean;
    hasUI: boolean;
    hasProviders: boolean;
    hasGuides: boolean;
  };
}

/**
 * CreatePluginCommand - Scaffolds a new OpenStarry plugin package.
 */
export class CreatePluginCommand implements CliCommand {
  name = "create-plugin";
  description = "Scaffold a new OpenStarry plugin package";

  async execute(args: ParsedArgs): Promise<number> {
    const forceOverwrite = args.flags.force === true;

    console.log("Creating a new OpenStarry plugin...\n");

    const result = await this.promptUser();

    if (!this.validatePluginName(result.name)) {
      console.error(`Invalid plugin name: ${result.name}`);
      console.error(`Plugin name must match pattern: [a-z0-9]+(-[a-z0-9]+)*`);
      return 1;
    }

    const targetDir = resolve(process.cwd(), result.name);

    if (existsSync(targetDir) && !forceOverwrite) {
      console.error(`Directory already exists: ${targetDir}`);
      console.error(`Use --force to overwrite.`);
      return 1;
    }

    const config = this.buildConfig(result);

    try {
      await this.generatePlugin(targetDir, config);
      console.log(`\nPlugin scaffolded: ./${result.name}/`);
      console.log(`\nNext steps:`);
      console.log(`  cd ${result.name}`);
      console.log(`  pnpm install`);
      console.log(`  pnpm build`);
      console.log(`  pnpm test`);
      return 0;
    } catch (err) {
      console.error(`Failed to generate plugin:`, err);
      return 1;
    }
  }

  private async promptUser(): Promise<CreatePluginPromptResult> {
    const prompter = new Prompter();

    const name = await prompter.ask("Plugin name (kebab-case)", "my-plugin");
    const description = await prompter.ask("Description", "An OpenStarry plugin");

    console.log("\nPlugin type:");
    console.log("  1. Tool (行蘊 - executable functions)");
    console.log("  2. Listener (受蘊 - input receivers)");
    console.log("  3. UI (色蘊 - output renderers)");
    console.log("  4. Provider (想蘊 - LLM backends)");
    console.log("  5. Guide (識蘊 - system prompts)");
    console.log("  6. Full (all capabilities)");

    const typeChoice = await prompter.ask("Enter number (1-6)", "1");

    const typeMap: Record<string, PluginType> = {
      "1": "tool",
      "2": "listener",
      "3": "ui",
      "4": "provider",
      "5": "guide",
      "6": "full",
    };

    const type = typeMap[typeChoice] ?? "tool";

    const author = await prompter.ask("Author (optional)", "");

    prompter.close();

    return { name, description, type, author };
  }

  private validatePluginName(name: string): boolean {
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
  }

  private buildConfig(result: CreatePluginPromptResult): PluginScaffoldConfig {
    const capabilities = {
      hasTools: result.type === "tool" || result.type === "full",
      hasListeners: result.type === "listener" || result.type === "full",
      hasUI: result.type === "ui" || result.type === "full",
      hasProviders: result.type === "provider" || result.type === "full",
      hasGuides: result.type === "guide" || result.type === "full",
    };

    return {
      name: result.name,
      namePascal: this.kebabToPascal(result.name),
      packageName: `@openstarry-plugin/${result.name}`,
      description: result.description,
      author: result.author || "",
      year: new Date().getFullYear().toString(),
      capabilities,
    };
  }

  private kebabToPascal(kebab: string): string {
    return kebab
      .split("-")
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
  }

  private async generatePlugin(
    targetDir: string,
    config: PluginScaffoldConfig,
  ): Promise<void> {
    await mkdir(targetDir, { recursive: true });
    await mkdir(resolve(targetDir, "src"), { recursive: true });

    await writeFile(
      resolve(targetDir, "package.json"),
      this.processTemplate(PACKAGE_JSON_TEMPLATE, config),
      "utf-8",
    );

    await writeFile(
      resolve(targetDir, "tsconfig.json"),
      this.processTemplate(TSCONFIG_TEMPLATE, config),
      "utf-8",
    );

    await writeFile(
      resolve(targetDir, "vitest.config.ts"),
      this.processTemplate(VITEST_CONFIG_TEMPLATE, config),
      "utf-8",
    );

    await writeFile(
      resolve(targetDir, "README.md"),
      this.processTemplate(README_TEMPLATE, config),
      "utf-8",
    );

    await writeFile(
      resolve(targetDir, "src", "index.ts"),
      this.processTemplate(SRC_INDEX_TEMPLATE, config),
      "utf-8",
    );

    await writeFile(
      resolve(targetDir, "src", "index.test.ts"),
      this.processTemplate(SRC_INDEX_TEST_TEMPLATE, config),
      "utf-8",
    );
  }

  private processTemplate(
    template: string,
    config: PluginScaffoldConfig,
  ): string {
    let result = template;

    result = result.replace(/\{\{PLUGIN_NAME\}\}/g, config.name);
    result = result.replace(/\{\{PLUGIN_NAME_PASCAL\}\}/g, config.namePascal);
    result = result.replace(/\{\{PACKAGE_NAME\}\}/g, config.packageName);
    result = result.replace(/\{\{DESCRIPTION\}\}/g, config.description);
    result = result.replace(/\{\{AUTHOR\}\}/g, config.author);
    result = result.replace(/\{\{YEAR\}\}/g, config.year);

    result = this.processConditionalBlocks(
      result,
      "HAS_TOOLS",
      config.capabilities.hasTools,
    );
    result = this.processConditionalBlocks(
      result,
      "HAS_LISTENERS",
      config.capabilities.hasListeners,
    );
    result = this.processConditionalBlocks(
      result,
      "HAS_UI",
      config.capabilities.hasUI,
    );
    result = this.processConditionalBlocks(
      result,
      "HAS_PROVIDERS",
      config.capabilities.hasProviders,
    );
    result = this.processConditionalBlocks(
      result,
      "HAS_GUIDES",
      config.capabilities.hasGuides,
    );

    return result;
  }

  private processConditionalBlocks(
    template: string,
    condition: string,
    enabled: boolean,
  ): string {
    const beginMarker = `// BEGIN:IF:${condition}`;
    const endMarker = `// END:IF:${condition}`;

    const regex = new RegExp(
      `${this.escapeRegex(beginMarker)}[\\s\\S]*?${this.escapeRegex(endMarker)}\\n?`,
      "g",
    );

    if (!enabled) {
      return template.replace(regex, "");
    }

    return template
      .replace(new RegExp(`${this.escapeRegex(beginMarker)}\\n?`, "g"), "")
      .replace(new RegExp(`${this.escapeRegex(endMarker)}\\n?`, "g"), "");
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}

// ========== Templates ==========

const PACKAGE_JSON_TEMPLATE = `{
  "name": "{{PACKAGE_NAME}}",
  "version": "0.1.0-alpha",
  "description": "{{DESCRIPTION}}",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "clean": "rimraf --glob dist \\"*.tsbuildinfo\\"",
    "dev": "tsc -b --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "keywords": ["openstarry", "plugin"],
  "author": "{{AUTHOR}}",
  "license": "MIT",
  "dependencies": {
    "@openstarry/sdk": "workspace:*",
    "@openstarry/shared": "workspace:*"// BEGIN:IF:HAS_TOOLS
,
    "zod": "^3.23.0"// END:IF:HAS_TOOLS
// BEGIN:IF:HAS_PROVIDERS
,
    "zod": "^3.23.0"// END:IF:HAS_PROVIDERS
  },
  "devDependencies": {
    "@types/node": "^25.2.0",
    "rimraf": "^5.0.0",
    "typescript": "^5.5.0",
    "vitest": "^4.0.18"
  }
}
`;

const TSCONFIG_TEMPLATE = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "composite": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
`;

const VITEST_CONFIG_TEMPLATE = `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
`;

const SRC_INDEX_TEMPLATE = `/**
 * {{PLUGIN_NAME_PASCAL}} Plugin
 * {{DESCRIPTION}}
 *
 * Five Aggregates Mapping:
// BEGIN:IF:HAS_TOOLS
 * - 行蘊 (ITool): Executable functions
// END:IF:HAS_TOOLS
// BEGIN:IF:HAS_LISTENERS
 * - 受蘊 (IListener): Input receivers
// END:IF:HAS_LISTENERS
// BEGIN:IF:HAS_UI
 * - 色蘊 (IUI): Output renderers
// END:IF:HAS_UI
// BEGIN:IF:HAS_PROVIDERS
 * - 想蘊 (IProvider): LLM backends
// END:IF:HAS_PROVIDERS
// BEGIN:IF:HAS_GUIDES
 * - 識蘊 (IGuide): System prompts
// END:IF:HAS_GUIDES
 */

import type {
  IPlugin,
  IPluginContext,
  PluginHooks,
// BEGIN:IF:HAS_TOOLS
  ITool,
// END:IF:HAS_TOOLS
// BEGIN:IF:HAS_LISTENERS
  IListener,
// END:IF:HAS_LISTENERS
// BEGIN:IF:HAS_UI
  IUI,
// END:IF:HAS_UI
// BEGIN:IF:HAS_PROVIDERS
  IProvider,
// END:IF:HAS_PROVIDERS
// BEGIN:IF:HAS_GUIDES
  IGuide,
// END:IF:HAS_GUIDES
} from "@openstarry/sdk";
// BEGIN:IF:HAS_TOOLS
import { z } from "zod";
// END:IF:HAS_TOOLS
// BEGIN:IF:HAS_PROVIDERS
import { z } from "zod";
// END:IF:HAS_PROVIDERS

/**
 * Optional configuration for {{PLUGIN_NAME_PASCAL}} plugin.
 */
export interface {{PLUGIN_NAME_PASCAL}}Config {
  // Add your plugin configuration here
}

/**
 * Create a new {{PLUGIN_NAME_PASCAL}} plugin instance.
 */
export function create{{PLUGIN_NAME_PASCAL}}Plugin(
  config?: {{PLUGIN_NAME_PASCAL}}Config,
): IPlugin {
  return {
    manifest: {
      name: "{{PLUGIN_NAME}}",
      version: "0.1.0-alpha",
      description: "{{DESCRIPTION}}",
      author: "{{AUTHOR}}",
    },

    async factory(ctx: IPluginContext): Promise<PluginHooks> {
      // TODO: Initialize your plugin here

      return {
// BEGIN:IF:HAS_TOOLS
        tools: [
          // TODO: Define your tools here
          // Example:
          // {
          //   id: "{{PLUGIN_NAME}}/my-tool",
          //   description: "Description of what this tool does",
          //   parameters: z.object({ input: z.string() }),
          //   execute: async (input, ctx) => {
          //     return "Tool result";
          //   },
          // }
        ],
// END:IF:HAS_TOOLS
// BEGIN:IF:HAS_LISTENERS
        listeners: [
          // TODO: Define your listeners here
          // Example:
          // {
          //   id: "{{PLUGIN_NAME}}/my-listener",
          //   register: (ctx) => {
          //     ctx.bus.on("agent:started", async (event) => {
          //       console.log("Agent started:", event);
          //     });
          //   },
          // }
        ],
// END:IF:HAS_LISTENERS
// BEGIN:IF:HAS_UI
        ui: [
          // TODO: Define your UI renderers here
          // Example:
          // {
          //   id: "{{PLUGIN_NAME}}/my-ui",
          //   render: async (event, ctx) => {
          //     if (event.type === "message:assistant") {
          //       console.log("Assistant:", event.payload);
          //     }
          //   },
          // }
        ],
// END:IF:HAS_UI
// BEGIN:IF:HAS_PROVIDERS
        providers: [
          // TODO: Define your LLM providers here
          // Example:
          // {
          //   id: "{{PLUGIN_NAME}}",
          //   name: "{{PLUGIN_NAME_PASCAL}} Provider",
          //   generateResponse: async function* (request, ctx) {
          //     // Implement LLM provider logic
          //     yield { type: "text_delta", text: "Response" };
          //     yield { type: "finish", stopReason: "end_turn" };
          //   },
          // }
        ],
// END:IF:HAS_PROVIDERS
// BEGIN:IF:HAS_GUIDES
        guides: [
          // TODO: Define your system prompts here
          // Example:
          // {
          //   id: "{{PLUGIN_NAME}}/default",
          //   content: "You are a helpful assistant powered by {{PLUGIN_NAME_PASCAL}}.",
          // }
        ],
// END:IF:HAS_GUIDES

        async dispose() {
          // TODO: Cleanup logic (close connections, clear timers)
        },
      };
    },
  };
}

export default create{{PLUGIN_NAME_PASCAL}}Plugin;
`;

const SRC_INDEX_TEST_TEMPLATE = `import { describe, it, expect } from "vitest";
import { createMockHost } from "@openstarry/sdk/testing";
import { create{{PLUGIN_NAME_PASCAL}}Plugin } from "./index.js";

describe("{{PLUGIN_NAME_PASCAL}}Plugin", () => {
  it("exports plugin factory", () => {
    expect(create{{PLUGIN_NAME_PASCAL}}Plugin).toBeDefined();
  });

  it("returns valid plugin manifest", () => {
    const plugin = create{{PLUGIN_NAME_PASCAL}}Plugin();
    expect(plugin.manifest.name).toBe("{{PLUGIN_NAME}}");
    expect(plugin.manifest.version).toBeDefined();
  });

  it("factory returns plugin hooks", async () => {
    const host = createMockHost();
    const ctx = host.createContext();
    const plugin = create{{PLUGIN_NAME_PASCAL}}Plugin();
    const hooks = await plugin.factory(ctx);

    expect(hooks).toBeDefined();
// BEGIN:IF:HAS_TOOLS
    expect(hooks.tools).toBeDefined();
    expect(Array.isArray(hooks.tools)).toBe(true);
// END:IF:HAS_TOOLS
// BEGIN:IF:HAS_LISTENERS
    expect(hooks.listeners).toBeDefined();
    expect(Array.isArray(hooks.listeners)).toBe(true);
// END:IF:HAS_LISTENERS
// BEGIN:IF:HAS_UI
    expect(hooks.ui).toBeDefined();
    expect(Array.isArray(hooks.ui)).toBe(true);
// END:IF:HAS_UI
// BEGIN:IF:HAS_PROVIDERS
    expect(hooks.providers).toBeDefined();
    expect(Array.isArray(hooks.providers)).toBe(true);
// END:IF:HAS_PROVIDERS
// BEGIN:IF:HAS_GUIDES
    expect(hooks.guides).toBeDefined();
    expect(Array.isArray(hooks.guides)).toBe(true);
// END:IF:HAS_GUIDES
  });
});
`;

const README_TEMPLATE = `# {{PACKAGE_NAME}}

{{DESCRIPTION}}

## Installation

\`\`\`bash
pnpm install
pnpm build
\`\`\`

## Usage

\`\`\`typescript
import { create{{PLUGIN_NAME_PASCAL}}Plugin } from "{{PACKAGE_NAME}}";

const plugin = create{{PLUGIN_NAME_PASCAL}}Plugin();
\`\`\`

## Development

\`\`\`bash
pnpm dev        # Watch mode
pnpm test       # Run tests
pnpm test:watch # Watch tests
\`\`\`

## Five Aggregates Mapping

This plugin implements:
// BEGIN:IF:HAS_TOOLS
- **行蘊 (ITool)**: Executable functions
// END:IF:HAS_TOOLS
// BEGIN:IF:HAS_LISTENERS
- **受蘊 (IListener)**: Input receivers
// END:IF:HAS_LISTENERS
// BEGIN:IF:HAS_UI
- **色蘊 (IUI)**: Output renderers
// END:IF:HAS_UI
// BEGIN:IF:HAS_PROVIDERS
- **想蘊 (IProvider)**: LLM backends
// END:IF:HAS_PROVIDERS
// BEGIN:IF:HAS_GUIDES
- **識蘊 (IGuide)**: System prompts
// END:IF:HAS_GUIDES

## License

MIT
`;
