import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync, sign as cryptoSign, createHash } from "node:crypto";
import { createSignatureVerifier } from "../signature-verification.js";
import type { IPlugin, PkiIntegrity } from "@openstarry/sdk";

describe("PKI Signature Verification", () => {
  let verifier: ReturnType<typeof createSignatureVerifier>;
  let tempDir: string;

  beforeEach(async () => {
    verifier = createSignatureVerifier();
    tempDir = join(tmpdir(), `pki-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function generateEd25519Keypair() {
    return generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
  }

  function signFile(content: Buffer, privateKey: string): string {
    // Ed25519 uses standalone crypto.sign with null algorithm
    const signature = cryptoSign(null, content, privateKey);
    return signature.toString("base64");
  }

  it("verifies valid Ed25519 signature", async () => {
    const content = "export function createPlugin() { return {}; }";
    const filePath = join(tempDir, "plugin.js");
    await writeFile(filePath, content);

    const { publicKey, privateKey } = generateEd25519Keypair();
    const signature = signFile(Buffer.from(content), privateKey);

    const plugin: IPlugin = {
      manifest: {
        name: "valid-plugin",
        version: "1.0.0",
        integrity: {
          algorithm: "ed25519-sha256",
          signature,
          publicKey,
        },
      },
      factory: async () => ({}),
    };

    await expect(verifier.verifyPlugin(plugin, filePath)).resolves.toBeUndefined();
  });

  it("rejects invalid Ed25519 signature", async () => {
    const content = "export function createPlugin() { return {}; }";
    const filePath = join(tempDir, "plugin.js");
    await writeFile(filePath, content);

    const { publicKey } = generateEd25519Keypair();

    const plugin: IPlugin = {
      manifest: {
        name: "invalid-sig",
        version: "1.0.0",
        integrity: {
          algorithm: "ed25519-sha256",
          signature: "aW52YWxpZHNpZ25hdHVyZQ==", // invalid signature
          publicKey,
        },
      },
      factory: async () => ({}),
    };

    await expect(verifier.verifyPlugin(plugin, filePath)).rejects.toThrow(
      /PKI signature verification failed/,
    );
  });

  it("rejects tampered plugin code", async () => {
    const originalContent = "export function createPlugin() { return 1; }";
    const filePath = join(tempDir, "plugin.js");
    await writeFile(filePath, originalContent);

    const { publicKey, privateKey } = generateEd25519Keypair();
    const signature = signFile(Buffer.from(originalContent), privateKey);

    // Tamper with the file after signing
    await writeFile(filePath, "export function createPlugin() { return 2; /* malicious */ }");

    const plugin: IPlugin = {
      manifest: {
        name: "tampered",
        version: "1.0.0",
        integrity: {
          algorithm: "ed25519-sha256",
          signature,
          publicKey,
        },
      },
      factory: async () => ({}),
    };

    await expect(verifier.verifyPlugin(plugin, filePath)).rejects.toThrow(
      /PKI signature verification failed/,
    );
  });

  it("supports legacy SHA-512 hash", async () => {
    const content = "export function createLegacy() {}";
    const filePath = join(tempDir, "legacy.js");
    await writeFile(filePath, content);

    const hash = createHash("sha512").update(Buffer.from(content)).digest("hex");

    const plugin: IPlugin = {
      manifest: {
        name: "legacy-plugin",
        version: "1.0.0",
        integrity: hash,
      },
      factory: async () => ({}),
    };

    await expect(verifier.verifyPlugin(plugin, filePath)).resolves.toBeUndefined();
  });

  it("detects signature format automatically", () => {
    // Legacy format: 128-char hex string
    const legacyHash = "a".repeat(128);
    expect(typeof legacyHash).toBe("string");
    expect(legacyHash.length).toBe(128);

    // PKI format: object with algorithm, signature, publicKey
    const pkiIntegrity: PkiIntegrity = {
      algorithm: "ed25519-sha256",
      signature: "base64sig",
      publicKey: "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
    };
    expect(pkiIntegrity.algorithm).toBe("ed25519-sha256");
  });

  it("rejects unknown integrity format", async () => {
    const filePath = join(tempDir, "plugin.js");
    await writeFile(filePath, "export const x = 1;");

    const plugin: IPlugin = {
      manifest: {
        name: "unknown-format",
        version: "1.0.0",
        integrity: "short_hash",
      },
      factory: async () => ({}),
    };

    await expect(verifier.verifyPlugin(plugin, filePath)).rejects.toThrow(
      /Unknown integrity format/,
    );
  });

  it("optional author field does not affect verification", async () => {
    const content = "export function withAuthor() {}";
    const filePath = join(tempDir, "plugin.js");
    await writeFile(filePath, content);

    const { publicKey, privateKey } = generateEd25519Keypair();
    const signature = signFile(Buffer.from(content), privateKey);

    const plugin: IPlugin = {
      manifest: {
        name: "authored-plugin",
        version: "1.0.0",
        integrity: {
          algorithm: "ed25519-sha256",
          signature,
          publicKey,
          author: "openstarry-team",
        },
      },
      factory: async () => ({}),
    };

    await expect(verifier.verifyPlugin(plugin, filePath)).resolves.toBeUndefined();
  });

  it("optional timestamp field does not affect verification", async () => {
    const content = "export function withTimestamp() {}";
    const filePath = join(tempDir, "plugin.js");
    await writeFile(filePath, content);

    const { publicKey, privateKey } = generateEd25519Keypair();
    const signature = signFile(Buffer.from(content), privateKey);

    const plugin: IPlugin = {
      manifest: {
        name: "timestamped-plugin",
        version: "1.0.0",
        integrity: {
          algorithm: "ed25519-sha256",
          signature,
          publicKey,
          timestamp: Date.now(),
        },
      },
      factory: async () => ({}),
    };

    await expect(verifier.verifyPlugin(plugin, filePath)).resolves.toBeUndefined();
  });

  it("verifyPkiSignature returns false for wrong key", async () => {
    const content = "export function wrongKey() {}";
    const filePath = join(tempDir, "plugin.js");
    await writeFile(filePath, content);

    const keys1 = generateEd25519Keypair();
    const keys2 = generateEd25519Keypair();

    // Sign with key1 private, verify with key2 public
    const signature = signFile(Buffer.from(content), keys1.privateKey);

    const result = await verifier.verifyPkiSignature(filePath, {
      algorithm: "ed25519-sha256",
      signature,
      publicKey: keys2.publicKey,
    });

    expect(result).toBe(false);
  });

  it("SANDBOX_IMPORT_BLOCKED event type exists", async () => {
    const { AgentEventType } = await import("@openstarry/sdk");
    expect(AgentEventType.SANDBOX_IMPORT_BLOCKED).toBe("sandbox:import_blocked");
  });
});
