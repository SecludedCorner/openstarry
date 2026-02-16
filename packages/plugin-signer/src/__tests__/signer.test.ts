import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateSigningKeypair,
  signPlugin,
  verifyPlugin,
  createPkiIntegrity,
  generateAndSaveKeypair,
} from "../index.js";

describe("Plugin Signer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `plugin-signer-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("generateSigningKeypair", () => {
    it("generates valid Ed25519 keypair", () => {
      const { publicKey, privateKey } = generateSigningKeypair();
      expect(publicKey).toContain("BEGIN PUBLIC KEY");
      expect(privateKey).toContain("BEGIN PRIVATE KEY");
    });

    it("generates unique keypairs", () => {
      const keys1 = generateSigningKeypair();
      const keys2 = generateSigningKeypair();
      expect(keys1.publicKey).not.toBe(keys2.publicKey);
      expect(keys1.privateKey).not.toBe(keys2.privateKey);
    });
  });

  describe("signPlugin", () => {
    it("produces base64 signature", async () => {
      const pluginPath = join(tempDir, "plugin.js");
      await writeFile(pluginPath, "export const x = 1;");

      const { privateKey } = generateSigningKeypair();
      const signature = await signPlugin(pluginPath, privateKey);

      expect(typeof signature).toBe("string");
      expect(signature.length).toBeGreaterThan(0);
      // Verify it's valid base64
      expect(Buffer.from(signature, "base64").toString("base64")).toBe(signature);
    });

    it("produces different signatures for different content", async () => {
      const path1 = join(tempDir, "plugin1.js");
      const path2 = join(tempDir, "plugin2.js");
      await writeFile(path1, "export const x = 1;");
      await writeFile(path2, "export const x = 2;");

      const { privateKey } = generateSigningKeypair();
      const sig1 = await signPlugin(path1, privateKey);
      const sig2 = await signPlugin(path2, privateKey);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe("verifyPlugin", () => {
    it("verifies valid signature", async () => {
      const pluginPath = join(tempDir, "plugin.js");
      await writeFile(pluginPath, "export function createPlugin() {}");

      const { publicKey, privateKey } = generateSigningKeypair();
      const signature = await signPlugin(pluginPath, privateKey);
      const valid = await verifyPlugin(pluginPath, signature, publicKey);

      expect(valid).toBe(true);
    });

    it("rejects tampered content", async () => {
      const pluginPath = join(tempDir, "plugin.js");
      await writeFile(pluginPath, "export function createPlugin() { return 1; }");

      const { publicKey, privateKey } = generateSigningKeypair();
      const signature = await signPlugin(pluginPath, privateKey);

      // Tamper with the file
      await writeFile(pluginPath, "export function createPlugin() { return 2; }");
      const valid = await verifyPlugin(pluginPath, signature, publicKey);

      expect(valid).toBe(false);
    });

    it("rejects wrong public key", async () => {
      const pluginPath = join(tempDir, "plugin.js");
      await writeFile(pluginPath, "export const x = 1;");

      const keys1 = generateSigningKeypair();
      const keys2 = generateSigningKeypair();
      const signature = await signPlugin(pluginPath, keys1.privateKey);
      const valid = await verifyPlugin(pluginPath, signature, keys2.publicKey);

      expect(valid).toBe(false);
    });

    it("rejects invalid signature", async () => {
      const pluginPath = join(tempDir, "plugin.js");
      await writeFile(pluginPath, "export const x = 1;");

      const { publicKey } = generateSigningKeypair();
      const valid = await verifyPlugin(pluginPath, "invalidbase64sig", publicKey);

      expect(valid).toBe(false);
    });
  });

  describe("createPkiIntegrity", () => {
    it("creates valid PkiIntegrity object", () => {
      const integrity = createPkiIntegrity("sig123", "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----");

      expect(integrity.algorithm).toBe("ed25519-sha256");
      expect(integrity.signature).toBe("sig123");
      expect(integrity.publicKey).toContain("BEGIN PUBLIC KEY");
      expect(integrity.timestamp).toBeGreaterThan(0);
    });

    it("includes optional author", () => {
      const integrity = createPkiIntegrity("sig", "key", { author: "test-team" });
      expect(integrity.author).toBe("test-team");
    });

    it("accepts custom timestamp", () => {
      const integrity = createPkiIntegrity("sig", "key", { timestamp: 1000 });
      expect(integrity.timestamp).toBe(1000);
    });
  });

  describe("generateAndSaveKeypair", () => {
    it("saves keypair to files", async () => {
      const privatePath = join(tempDir, "private.pem");
      const publicPath = join(tempDir, "public.pem");

      const keys = await generateAndSaveKeypair(privatePath, publicPath);

      const savedPrivate = await readFile(privatePath, "utf-8");
      const savedPublic = await readFile(publicPath, "utf-8");

      expect(savedPrivate).toBe(keys.privateKey);
      expect(savedPublic).toBe(keys.publicKey);
      expect(savedPrivate).toContain("BEGIN PRIVATE KEY");
      expect(savedPublic).toContain("BEGIN PUBLIC KEY");
    });
  });

  describe("end-to-end workflow", () => {
    it("keygen -> sign -> verify roundtrip", async () => {
      // Generate keys
      const keys = generateSigningKeypair();

      // Create plugin
      const pluginPath = join(tempDir, "my-plugin.js");
      await writeFile(pluginPath, `
        export function createMyPlugin() {
          return {
            manifest: { name: "my-plugin", version: "1.0.0" },
            factory: async () => ({}),
          };
        }
      `);

      // Sign
      const signature = await signPlugin(pluginPath, keys.privateKey);

      // Create integrity object
      const integrity = createPkiIntegrity(signature, keys.publicKey, {
        author: "test-author",
      });

      // Verify
      const valid = await verifyPlugin(pluginPath, integrity.signature, integrity.publicKey);
      expect(valid).toBe(true);

      // Verify format
      expect(integrity.algorithm).toBe("ed25519-sha256");
      expect(integrity.author).toBe("test-author");
    });
  });
});
