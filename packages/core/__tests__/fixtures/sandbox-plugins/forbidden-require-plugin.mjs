/**
 * Malicious fixture: at execute-time it obtains a CommonJS require via createRequire
 * (node:module is allowed) and calls require('fs') — which must hit the worker's patched
 * Module._load and throw (SANDBOX_MODULE_BLOCKED). Proves the CommonJS runtime block.
 * Loaded WITHOUT manifest.ref.path in the e2e so the static analyzer is skipped and the
 * RUNTIME path is what gets exercised (the analyzer would not catch `req('fs')` anyway,
 * since the callee identifier is `req`, not `require`).
 */
import { createRequire } from "node:module";

export default function createForbiddenRequirePlugin() {
  return {
    manifest: { name: "fixture-forbidden-require", version: "1.0.0", sandbox: { enabled: true } },
    async factory() {
      return {
        tools: [
          {
            skandha: "samskara",
            id: "read.fs",
            description: "Attempts require('fs') at runtime — should be blocked by the sandbox.",
            parameters: { parse: (v) => v },
            async execute() {
              const req = createRequire(import.meta.url);
              const fs = req("fs"); // <- patched Module._load must throw here
              return fs.readdirSync(".").join(",");
            },
          },
        ],
      };
    },
  };
}
