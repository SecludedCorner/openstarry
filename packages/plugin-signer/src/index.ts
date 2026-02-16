/**
 * Plugin signer — Ed25519/RSA signing utilities for OpenStarry plugins.
 */

import {
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  createSign,
  createVerify,
} from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { PkiIntegrity } from "@openstarry/sdk";

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

/**
 * Generate an Ed25519 keypair for plugin signing.
 */
export function generateSigningKeypair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

/**
 * Sign a plugin file with an Ed25519 private key.
 * Returns a base64-encoded signature.
 */
export async function signPlugin(
  pluginPath: string,
  privateKeyPem: string,
): Promise<string> {
  const content = await readFile(pluginPath);
  const signature = cryptoSign(null, content, privateKeyPem);
  return signature.toString("base64");
}

/**
 * Verify a plugin file against an Ed25519 signature.
 * Returns true if the signature is valid.
 */
export async function verifyPlugin(
  pluginPath: string,
  signature: string,
  publicKeyPem: string,
): Promise<boolean> {
  const content = await readFile(pluginPath);
  const signatureBuffer = Buffer.from(signature, "base64");

  try {
    return cryptoVerify(null, content, publicKeyPem, signatureBuffer);
  } catch {
    return false;
  }
}

/**
 * Create a PkiIntegrity object for embedding in plugin manifests.
 */
export function createPkiIntegrity(
  signature: string,
  publicKey: string,
  options?: { author?: string; timestamp?: number },
): PkiIntegrity {
  return {
    algorithm: "ed25519-sha256",
    signature,
    publicKey,
    author: options?.author,
    timestamp: options?.timestamp ?? Date.now(),
  };
}

/**
 * Generate keypair and save to files.
 */
export async function generateAndSaveKeypair(
  privateKeyPath: string,
  publicKeyPath: string,
): Promise<KeyPair> {
  const keys = generateSigningKeypair();
  await writeFile(privateKeyPath, keys.privateKey, "utf-8");
  await writeFile(publicKeyPath, keys.publicKey, "utf-8");
  return keys;
}
