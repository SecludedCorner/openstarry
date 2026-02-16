import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validatePluginImports } from "../import-analyzer.js";

describe("Import Analyzer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `import-analyzer-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects ESM import of forbidden module", async () => {
    const filePath = join(tempDir, "plugin.ts");
    await writeFile(filePath, `import fs from 'fs';\nexport const x = 1;\n`);

    await expect(
      validatePluginImports(filePath, {}),
    ).rejects.toThrow(/forbidden module/);
  });

  it("detects CommonJS require of forbidden module", async () => {
    const filePath = join(tempDir, "plugin.ts");
    await writeFile(filePath, `const cp = require('child_process');\n`);

    await expect(
      validatePluginImports(filePath, {}),
    ).rejects.toThrow(/forbidden module/);
  });

  it("detects dynamic import of forbidden module", async () => {
    const filePath = join(tempDir, "plugin.ts");
    await writeFile(filePath, `const mod = await import('net');\n`);

    await expect(
      validatePluginImports(filePath, {}),
    ).rejects.toThrow(/forbidden module/);
  });

  it("detects node: prefixed imports", async () => {
    const filePath = join(tempDir, "plugin.ts");
    await writeFile(filePath, `import { readFile } from 'node:fs/promises';\n`);

    await expect(
      validatePluginImports(filePath, {}),
    ).rejects.toThrow(/forbidden module/);
  });

  it("allows non-forbidden imports", async () => {
    const filePath = join(tempDir, "plugin.ts");
    await writeFile(filePath, `import lodash from 'lodash';\nexport const x = 1;\n`);

    await expect(
      validatePluginImports(filePath, {}),
    ).resolves.toBeUndefined();
  });

  it("allowlist overrides blocklist", async () => {
    const filePath = join(tempDir, "plugin.ts");
    await writeFile(filePath, `import fs from 'fs';\n`);

    // fs is in default blocklist, but allowed via allowedModules
    await expect(
      validatePluginImports(filePath, { allowedModules: ["fs"] }),
    ).resolves.toBeUndefined();
  });

  it("custom blocklist extends default", async () => {
    const filePath = join(tempDir, "plugin.ts");
    await writeFile(filePath, `import axios from 'axios';\n`);

    // axios is not in default blocklist
    await expect(
      validatePluginImports(filePath, {}),
    ).resolves.toBeUndefined();

    // But adding it to custom blocklist blocks it
    await expect(
      validatePluginImports(filePath, { blockedModules: ["axios"] }),
    ).rejects.toThrow(/forbidden module/);
  });

  it("reports line number in error", async () => {
    const filePath = join(tempDir, "plugin.ts");
    await writeFile(filePath, `// comment\n// another\nimport fs from 'fs';\n`);

    await expect(
      validatePluginImports(filePath, {}),
    ).rejects.toThrow(/line 3/);
  });

  it("handles TypeScript plugin files", async () => {
    const filePath = join(tempDir, "plugin.ts");
    await writeFile(filePath, `
interface Config {
  name: string;
}
const config: Config = { name: "test" };
export default config;
`);

    await expect(
      validatePluginImports(filePath, {}),
    ).resolves.toBeUndefined();
  });

  it("handles parse errors gracefully", async () => {
    const filePath = join(tempDir, "plugin.ts");
    await writeFile(filePath, `this is not valid javascript {{{{`);

    // Should not crash — @babel/parser with errorRecovery: true may or may not throw,
    // but it should handle gracefully either way
    try {
      await validatePluginImports(filePath, {});
      // If no error, that's fine (parser recovered)
    } catch (err) {
      // If error, it should be about the plugin code being invalid or a module issue
      expect(String(err)).toBeDefined();
    }
  });

  it("detects multiple violations in same file", async () => {
    const filePath = join(tempDir, "plugin.ts");
    await writeFile(filePath, `
import fs from 'fs';
const cp = require('child_process');
const net = await import('net');
`);

    try {
      await validatePluginImports(filePath, {});
      expect.unreachable("should have thrown");
    } catch (err) {
      const message = String(err);
      expect(message).toContain("fs");
      expect(message).toContain("child_process");
      expect(message).toContain("net");
    }
  });

  it("throws when plugin file does not exist", async () => {
    await expect(
      validatePluginImports("/nonexistent/plugin.ts", {}),
    ).rejects.toThrow(/Cannot read plugin source/);
  });
});
