#!/usr/bin/env node

/**
 * CLI entry point for openstarry-signer.
 * Usage:
 *   openstarry-signer keygen --output ./keys/
 *   openstarry-signer sign --plugin ./plugin.js --key ./keys/private.pem
 *   openstarry-signer verify --plugin ./plugin.js --key ./keys/public.pem --signature <base64>
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  generateAndSaveKeypair,
  signPlugin,
  verifyPlugin,
  createPkiIntegrity,
} from "./index.js";

const args = process.argv.slice(2);
const command = args[0];

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

async function main(): Promise<void> {
  switch (command) {
    case "keygen": {
      const output = getArg("output") ?? ".";
      const privatePath = join(output, "private.pem");
      const publicPath = join(output, "public.pem");
      const keys = await generateAndSaveKeypair(privatePath, publicPath);
      console.log(`Ed25519 keypair generated:`);
      console.log(`  Private key: ${privatePath}`);
      console.log(`  Public key:  ${publicPath}`);
      break;
    }

    case "sign": {
      const pluginPath = getArg("plugin");
      const keyPath = getArg("key");
      if (!pluginPath || !keyPath) {
        console.error("Usage: openstarry-signer sign --plugin <path> --key <private-key-path>");
        process.exit(1);
      }
      const privateKey = await readFile(keyPath, "utf-8");
      const signature = await signPlugin(pluginPath, privateKey);
      console.log(`Signature: ${signature}`);

      const author = getArg("author");
      const publicKeyPath = getArg("public-key");
      if (publicKeyPath) {
        const publicKey = await readFile(publicKeyPath, "utf-8");
        const integrity = createPkiIntegrity(signature, publicKey, { author });
        console.log(`\nPkiIntegrity (for manifest):`);
        console.log(JSON.stringify(integrity, null, 2));
      }
      break;
    }

    case "verify": {
      const pluginPath = getArg("plugin");
      const keyPath = getArg("key");
      const signature = getArg("signature");
      if (!pluginPath || !keyPath || !signature) {
        console.error("Usage: openstarry-signer verify --plugin <path> --key <public-key-path> --signature <base64>");
        process.exit(1);
      }
      const publicKey = await readFile(keyPath, "utf-8");
      const valid = await verifyPlugin(pluginPath, signature, publicKey);
      console.log(valid ? "Signature VALID" : "Signature INVALID");
      process.exit(valid ? 0 : 1);
      break;
    }

    default:
      console.error("Usage: openstarry-signer <keygen|sign|verify> [options]");
      console.error("\nCommands:");
      console.error("  keygen   Generate Ed25519 keypair");
      console.error("  sign     Sign a plugin file");
      console.error("  verify   Verify a plugin signature");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
