/**
 * Plugin signature verification — supports SHA-512 hash (legacy) and Ed25519/RSA PKI signatures.
 */

import { createHash, createVerify, verify as cryptoVerify } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IPlugin, PkiIntegrity } from "@openstarry/sdk";
import { SandboxError } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("SignatureVerifier");

export interface SignatureVerifier {
  /** Verify plugin with legacy hash OR PKI signature */
  verifyPlugin(plugin: IPlugin, pluginCodePath: string): Promise<void>;
  /** Compute SHA-512 hash (legacy) */
  computeHash(filePath: string): Promise<string>;
  /** Verify PKI signature (new) */
  verifyPkiSignature(filePath: string, integrity: PkiIntegrity): Promise<boolean>;
}

/**
 * Detect legacy SHA-512 hash format: 128-character hex string.
 */
function isLegacyHashFormat(integrity: unknown): integrity is string {
  return typeof integrity === "string" && /^[0-9a-f]{128}$/.test(integrity);
}

/**
 * Detect PKI signature format: object with algorithm, signature, publicKey.
 */
function isPkiSignatureFormat(integrity: unknown): integrity is PkiIntegrity {
  return (
    typeof integrity === "object" &&
    integrity !== null &&
    "algorithm" in integrity &&
    "signature" in integrity &&
    "publicKey" in integrity
  );
}

export function createSignatureVerifier(): SignatureVerifier {
  return {
    async verifyPlugin(plugin: IPlugin, pluginCodePath: string): Promise<void> {
      const integrity = plugin.manifest.integrity;
      if (!integrity) {
        logger.warn("Plugin has no integrity field, skipping verification", {
          plugin: plugin.manifest.name,
        });
        return;
      }

      // Detect format
      if (isLegacyHashFormat(integrity)) {
        // Legacy SHA-512 verification
        const actualHash = await this.computeHash(pluginCodePath);
        if (actualHash !== integrity) {
          throw new SandboxError(
            plugin.manifest.name,
            `SHA-512 hash mismatch. Expected: ${integrity.slice(0, 16)}..., Got: ${actualHash.slice(0, 16)}...`,
            { code: "SIGNATURE_MISMATCH" },
          );
        }
        logger.info("Plugin SHA-512 hash verified (legacy)", {
          plugin: plugin.manifest.name,
        });
      } else if (isPkiSignatureFormat(integrity)) {
        // PKI signature verification
        const verified = await this.verifyPkiSignature(pluginCodePath, integrity);
        if (!verified) {
          throw new SandboxError(
            plugin.manifest.name,
            `PKI signature verification failed (algorithm: ${integrity.algorithm})`,
            { code: "SIGNATURE_VERIFICATION_FAILED" },
          );
        }
        logger.info("Plugin PKI signature verified", {
          plugin: plugin.manifest.name,
          algorithm: integrity.algorithm,
          author: integrity.author,
        });
      } else {
        throw new SandboxError(
          plugin.manifest.name,
          "Unknown integrity format (expected SHA-512 hash or PKI signature)",
          { code: "INVALID_INTEGRITY_FORMAT" },
        );
      }
    },

    async computeHash(filePath: string): Promise<string> {
      const content = await readFile(filePath);
      return createHash("sha512").update(content).digest("hex");
    },

    async verifyPkiSignature(filePath: string, integrity: PkiIntegrity): Promise<boolean> {
      const content = await readFile(filePath);

      // Validate algorithm
      if (integrity.algorithm !== "ed25519-sha256" && integrity.algorithm !== "rsa-sha256") {
        throw new Error(`Unsupported signature algorithm: ${integrity.algorithm}`);
      }

      const signatureBuffer = Buffer.from(integrity.signature, "base64");

      try {
        if (integrity.algorithm === "ed25519-sha256") {
          // Ed25519 uses standalone crypto.verify with null algorithm
          return cryptoVerify(null, content, integrity.publicKey, signatureBuffer);
        } else {
          // RSA uses createVerify with SHA256
          const verify = createVerify("SHA256");
          verify.update(content);
          verify.end();
          return verify.verify(integrity.publicKey, signatureBuffer);
        }
      } catch (err) {
        logger.error("PKI signature verification error", {
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },
  };
}
