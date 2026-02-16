/**
 * CreatePluginCommand unit tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import type { ParsedArgs } from "../../src/commands/base.js";
import { CreatePluginCommand } from "../../src/commands/create-plugin.js";

describe("CreatePluginCommand", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = resolve(tmpdir(), `create-plugin-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("Command metadata", () => {
    it("has correct name and description", () => {
      const cmd = new CreatePluginCommand();
      expect(cmd.name).toBe("create-plugin");
      expect(cmd.description).toBe("Scaffold a new OpenStarry plugin package");
    });
  });

  describe("Plugin name validation", () => {
    it("accepts valid kebab-case names", () => {
      const cmd = new CreatePluginCommand();
      expect((cmd as any).validatePluginName("my-plugin")).toBe(true);
      expect((cmd as any).validatePluginName("my-awesome-plugin")).toBe(true);
      expect((cmd as any).validatePluginName("plugin123")).toBe(true);
      expect((cmd as any).validatePluginName("123plugin")).toBe(true);
    });

    it("rejects invalid names", () => {
      const cmd = new CreatePluginCommand();
      expect((cmd as any).validatePluginName("MyPlugin")).toBe(false);
      expect((cmd as any).validatePluginName("my_plugin")).toBe(false);
      expect((cmd as any).validatePluginName("my plugin")).toBe(false);
      expect((cmd as any).validatePluginName("my--plugin")).toBe(false);
      expect((cmd as any).validatePluginName("-myplugin")).toBe(false);
      expect((cmd as any).validatePluginName("myplugin-")).toBe(false);
    });
  });

  describe("kebabToPascal conversion", () => {
    it("converts kebab-case to PascalCase", () => {
      const cmd = new CreatePluginCommand();
      expect((cmd as any).kebabToPascal("my-plugin")).toBe("MyPlugin");
      expect((cmd as any).kebabToPascal("my-awesome-plugin")).toBe("MyAwesomePlugin");
      expect((cmd as any).kebabToPascal("plugin")).toBe("Plugin");
    });
  });

  describe("Template substitution", () => {
    it("replaces all template variables", () => {
      const cmd = new CreatePluginCommand();
      const config = {
        name: "test-plugin",
        namePascal: "TestPlugin",
        packageName: "@openstarry-plugin/test-plugin",
        description: "A test plugin",
        author: "Test Author",
        year: "2026",
        capabilities: {
          hasTools: false,
          hasListeners: false,
          hasUI: false,
          hasProviders: false,
          hasGuides: false,
        },
      };

      const template = `{{PLUGIN_NAME}} {{PLUGIN_NAME_PASCAL}} {{PACKAGE_NAME}} {{DESCRIPTION}} {{AUTHOR}} {{YEAR}}`;
      const result = (cmd as any).processTemplate(template, config);

      expect(result).toBe("test-plugin TestPlugin @openstarry-plugin/test-plugin A test plugin Test Author 2026");
    });

    it("removes conditional blocks when disabled", () => {
      const cmd = new CreatePluginCommand();
      const config = {
        name: "test-plugin",
        namePascal: "TestPlugin",
        packageName: "@openstarry-plugin/test-plugin",
        description: "A test plugin",
        author: "Test Author",
        year: "2026",
        capabilities: {
          hasTools: false,
          hasListeners: false,
          hasUI: false,
          hasProviders: false,
          hasGuides: false,
        },
      };

      const template = `Line 1
// BEGIN:IF:HAS_TOOLS
This should be removed
// END:IF:HAS_TOOLS
Line 2`;

      const result = (cmd as any).processTemplate(template, config);
      expect(result).toBe("Line 1\nLine 2");
    });

    it("keeps conditional blocks when enabled", () => {
      const cmd = new CreatePluginCommand();
      const config = {
        name: "test-plugin",
        namePascal: "TestPlugin",
        packageName: "@openstarry-plugin/test-plugin",
        description: "A test plugin",
        author: "Test Author",
        year: "2026",
        capabilities: {
          hasTools: true,
          hasListeners: false,
          hasUI: false,
          hasProviders: false,
          hasGuides: false,
        },
      };

      const template = `Line 1
// BEGIN:IF:HAS_TOOLS
This should be kept
// END:IF:HAS_TOOLS
Line 2`;

      const result = (cmd as any).processTemplate(template, config);
      expect(result).toContain("This should be kept");
      expect(result).not.toContain("BEGIN:IF:HAS_TOOLS");
      expect(result).not.toContain("END:IF:HAS_TOOLS");
    });
  });

  describe("File generation", () => {
    it("generates all required files for tool plugin", async () => {
      const cmd = new CreatePluginCommand();
      const config = {
        name: "test-tool",
        namePascal: "TestTool",
        packageName: "@openstarry-plugin/test-tool",
        description: "A test tool plugin",
        author: "Test Author",
        year: "2026",
        capabilities: {
          hasTools: true,
          hasListeners: false,
          hasUI: false,
          hasProviders: false,
          hasGuides: false,
        },
      };

      const targetDir = resolve(tempDir, "test-tool");
      await (cmd as any).generatePlugin(targetDir, config);

      expect(existsSync(resolve(targetDir, "package.json"))).toBe(true);
      expect(existsSync(resolve(targetDir, "tsconfig.json"))).toBe(true);
      expect(existsSync(resolve(targetDir, "vitest.config.ts"))).toBe(true);
      expect(existsSync(resolve(targetDir, "README.md"))).toBe(true);
      expect(existsSync(resolve(targetDir, "src", "index.ts"))).toBe(true);
      expect(existsSync(resolve(targetDir, "src", "index.test.ts"))).toBe(true);
    });

    it("generates tool plugin with correct tools array", async () => {
      const cmd = new CreatePluginCommand();
      const config = {
        name: "test-tool",
        namePascal: "TestTool",
        packageName: "@openstarry-plugin/test-tool",
        description: "A test tool plugin",
        author: "Test Author",
        year: "2026",
        capabilities: {
          hasTools: true,
          hasListeners: false,
          hasUI: false,
          hasProviders: false,
          hasGuides: false,
        },
      };

      const targetDir = resolve(tempDir, "test-tool");
      await (cmd as any).generatePlugin(targetDir, config);

      const indexContent = await readFile(resolve(targetDir, "src", "index.ts"), "utf-8");
      expect(indexContent).toContain("tools: [");
      expect(indexContent).not.toContain("listeners: [");
      expect(indexContent).not.toContain("ui: [");
      expect(indexContent).toContain("import { z } from \"zod\"");
    });

    it("generates full plugin with all capabilities", async () => {
      const cmd = new CreatePluginCommand();
      const config = {
        name: "test-full",
        namePascal: "TestFull",
        packageName: "@openstarry-plugin/test-full",
        description: "A full plugin",
        author: "Test Author",
        year: "2026",
        capabilities: {
          hasTools: true,
          hasListeners: true,
          hasUI: true,
          hasProviders: true,
          hasGuides: true,
        },
      };

      const targetDir = resolve(tempDir, "test-full");
      await (cmd as any).generatePlugin(targetDir, config);

      const indexContent = await readFile(resolve(targetDir, "src", "index.ts"), "utf-8");
      expect(indexContent).toContain("tools: [");
      expect(indexContent).toContain("listeners: [");
      expect(indexContent).toContain("ui: [");
      expect(indexContent).toContain("providers: [");
      expect(indexContent).toContain("guides: [");
    });

    it("generates valid package.json with zod dependency for tools", async () => {
      const cmd = new CreatePluginCommand();
      const config = {
        name: "test-tool",
        namePascal: "TestTool",
        packageName: "@openstarry-plugin/test-tool",
        description: "A test tool plugin",
        author: "Test Author",
        year: "2026",
        capabilities: {
          hasTools: true,
          hasListeners: false,
          hasUI: false,
          hasProviders: false,
          hasGuides: false,
        },
      };

      const targetDir = resolve(tempDir, "test-tool");
      await (cmd as any).generatePlugin(targetDir, config);

      const pkgContent = await readFile(resolve(targetDir, "package.json"), "utf-8");
      const pkg = JSON.parse(pkgContent);

      expect(pkg.name).toBe("@openstarry-plugin/test-tool");
      expect(pkg.dependencies["@openstarry/sdk"]).toBeDefined();
      expect(pkg.dependencies["zod"]).toBe("^3.23.0");
    });
  });

  describe("Config building", () => {
    it("builds correct config for tool type", () => {
      const cmd = new CreatePluginCommand();
      const result = {
        name: "my-tool",
        description: "A tool",
        type: "tool" as const,
        author: "Author",
      };

      const config = (cmd as any).buildConfig(result);

      expect(config.capabilities.hasTools).toBe(true);
      expect(config.capabilities.hasListeners).toBe(false);
      expect(config.capabilities.hasUI).toBe(false);
      expect(config.capabilities.hasProviders).toBe(false);
      expect(config.capabilities.hasGuides).toBe(false);
    });

    it("builds correct config for full type", () => {
      const cmd = new CreatePluginCommand();
      const result = {
        name: "my-full",
        description: "A full plugin",
        type: "full" as const,
        author: "Author",
      };

      const config = (cmd as any).buildConfig(result);

      expect(config.capabilities.hasTools).toBe(true);
      expect(config.capabilities.hasListeners).toBe(true);
      expect(config.capabilities.hasUI).toBe(true);
      expect(config.capabilities.hasProviders).toBe(true);
      expect(config.capabilities.hasGuides).toBe(true);
    });
  });
});
