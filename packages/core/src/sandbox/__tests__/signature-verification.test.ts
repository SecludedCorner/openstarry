import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createSignatureVerifier } from "../signature-verification.js";
import type { IPlugin } from "@openstarry/sdk";

describe("SignatureVerifier", () => {
  let verifier: ReturnType<typeof createSignatureVerifier>;
  let tempDir: string;

  beforeEach(async () => {
    verifier = createSignatureVerifier();
    tempDir = join(tmpdir(), `sandbox-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("computes SHA-512 hash correctly", async () => {
    const content = "export function createTestPlugin() {}";
    const filePath = join(tempDir, "plugin.js");
    await writeFile(filePath, content);

    const hash = await verifier.computeHash(filePath);
    const expected = createHash("sha512").update(Buffer.from(content)).digest("hex");

    expect(hash).toBe(expected);
    expect(hash).toHaveLength(128); // SHA-512 hex = 128 chars
  });

  it("verifies plugin with matching integrity hash", async () => {
    const content = "export function createFooPlugin() {}";
    const filePath = join(tempDir, "foo.js");
    await writeFile(filePath, content);

    const hash = createHash("sha512").update(Buffer.from(content)).digest("hex");
    const plugin: IPlugin = {
      manifest: { name: "foo", version: "1.0.0", integrity: hash },
      factory: async () => ({}),
    };

    await expect(verifier.verifyPlugin(plugin, filePath)).resolves.toBeUndefined();
  });

  it("throws SandboxError on integrity mismatch", async () => {
    const content = "export function createBarPlugin() {}";
    const filePath = join(tempDir, "bar.js");
    await writeFile(filePath, content);

    const plugin: IPlugin = {
      manifest: { name: "bar", version: "1.0.0", integrity: "bad_hash" },
      factory: async () => ({}),
    };

    await expect(verifier.verifyPlugin(plugin, filePath)).rejects.toThrow(
      /Unknown integrity format/,
    );
  });

  it("skips verification when no integrity hash", async () => {
    const plugin: IPlugin = {
      manifest: { name: "no-hash", version: "1.0.0" },
      factory: async () => ({}),
    };

    // Should not throw, even though the file doesn't exist
    await expect(verifier.verifyPlugin(plugin, "/nonexistent")).resolves.toBeUndefined();
  });

  it("detects tampering after file modification", async () => {
    const originalContent = "export function createPlugin() { return 1; }";
    const filePath = join(tempDir, "tampered.js");
    await writeFile(filePath, originalContent);

    const hash = createHash("sha512").update(Buffer.from(originalContent)).digest("hex");
    const plugin: IPlugin = {
      manifest: { name: "tampered", version: "1.0.0", integrity: hash },
      factory: async () => ({}),
    };

    // Tamper with the file
    await writeFile(filePath, "export function createPlugin() { return 2; /* malicious */ }");

    await expect(verifier.verifyPlugin(plugin, filePath)).rejects.toThrow(
      /SHA-512 hash mismatch/,
    );
  });
});
