# @openstarry/plugin-signer

Ed25519/RSA signing and verification utilities for OpenStarry plugin integrity.

## Installation

```bash
pnpm add @openstarry/plugin-signer
```

## Usage

### Generating a Keypair

```typescript
import { generateSigningKeypair } from "@openstarry/plugin-signer";

const { publicKey, privateKey } = generateSigningKeypair();
// publicKey/privateKey are PEM-encoded strings
```

### Signing a Plugin

```typescript
import { signPlugin, createPkiIntegrity } from "@openstarry/plugin-signer";

const signature = await signPlugin("./dist/plugin.js", privateKey);

const integrity = createPkiIntegrity(signature, publicKey, {
  author: "alice@example.com",
  timestamp: Date.now(),
});

// Add to plugin manifest
manifest.integrity = integrity;
```

### Verifying a Plugin

```typescript
import { verifyPlugin } from "@openstarry/plugin-signer";

const isValid = await verifyPlugin(
  "./dist/plugin.js",
  integrity.signature,
  integrity.publicKey
);

if (!isValid) {
  throw new Error("Plugin signature verification failed");
}
```

### Saving Keypair to Files

```typescript
import { generateAndSaveKeypair } from "@openstarry/plugin-signer";

await generateAndSaveKeypair(
  "~/.openstarry/keys/plugin-signing.pem",
  "~/.openstarry/keys/plugin-signing.pub"
);
```

## CLI Tool

The package includes a CLI for plugin signing:

```bash
# Generate keypair
npx @openstarry/plugin-signer keygen --private ./private.pem --public ./public.pem

# Sign a plugin
npx @openstarry/plugin-signer sign --plugin ./dist/plugin.js --key ./private.pem --output ./signature.txt

# Verify a plugin
npx @openstarry/plugin-signer verify --plugin ./dist/plugin.js --signature ./signature.txt --key ./public.pem
```

## Plugin Manifest Integration

Embed the signature in your plugin manifest:

```typescript
import type { IPlugin, PkiIntegrity } from "@openstarry/sdk";

const integrity: PkiIntegrity = {
  algorithm: "ed25519-sha256",
  signature: "base64-encoded-signature",
  publicKey: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
  author: "alice@example.com",
  timestamp: 1704067200000,
};

export function createMyPlugin(): IPlugin {
  return {
    manifest: {
      name: "@openstarry-plugin/my-plugin",
      version: "1.0.0",
      integrity, // <-- Add signature here
    },
    async factory(ctx) {
      // ... plugin implementation
    },
  };
}
```

## Security Model

- **Ed25519** signatures (default) — Fast, secure, 256-bit elliptic curve
- **RSA-2048/4096** signatures (future extension) — Industry-standard PKI
- **SHA-256** hash function for message digest
- **PEM-encoded keys** — Standard format, compatible with OpenSSL

## Verification Flow

When a plugin is loaded with `sandbox.enabled: true`, the core runtime:

1. Checks if `manifest.integrity` exists
2. If present, verifies signature against plugin file hash
3. Throws `SecurityError` if verification fails
4. Proceeds to load plugin if verification succeeds (or if no signature present)

## Development

```bash
# Build
pnpm build

# Run tests
pnpm test
```

## License

MIT
