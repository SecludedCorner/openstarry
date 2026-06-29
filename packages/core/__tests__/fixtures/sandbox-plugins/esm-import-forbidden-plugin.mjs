/**
 * Honest demonstration of the ESM interception boundary: this fixture STATICALLY imports
 * a forbidden builtin (node:child_process). The e2e loads it WITH manifest.ref.path set so
 * the static import-analyzer (sandbox-manager Step 1.5) parses it and rejects it BEFORE the
 * worker spawns (SANDBOX_IMPORT_BLOCKED). It documents that ESM imports are caught by the
 * static analyzer, NOT by the runtime Module._load hook (which is CommonJS-only).
 */
import { spawn } from "node:child_process";

export default function createEsmImportForbiddenPlugin() {
  void spawn;
  return {
    manifest: { name: "fixture-esm-import", version: "1.0.0", sandbox: { enabled: true } },
    async factory() {
      return { tools: [] };
    },
  };
}
