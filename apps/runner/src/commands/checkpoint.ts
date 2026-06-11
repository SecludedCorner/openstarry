/**
 * checkpoint command — Plan47 C47-K3-M3 Option C CLI escape hatch.
 *
 * Offline operations on checkpoint blobs produced by the daemon lifecycle
 * (apps/runner/src/commands/start.ts). Runs without a live Core / plugin
 * loader so it never touches the MR-6 boundary.
 *
 * Subcommands:
 *   openstarry checkpoint verify  <path> [--hmac-key <hex>]
 *   openstarry checkpoint inspect <path>                  # metadata only
 *
 * HMAC key precedence: --hmac-key flag > OPENSTARRY_CHECKPOINT_HMAC_KEY env.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { CliCommand, ParsedArgs } from "./base.js";
import { readSnapshotStore } from "../utils/snapshot-store.js";

export class CheckpointCommand implements CliCommand {
  name = "checkpoint";
  description = "Verify or inspect a runner checkpoint blob (Plan47 K-3)";

  async execute(args: ParsedArgs): Promise<number> {
    const subcommand = args.positional[0];
    const path = args.positional[1];

    if (!subcommand) {
      console.error("Usage: openstarry checkpoint <verify|inspect> <path>");
      return 1;
    }
    if (!path) {
      console.error(`Usage: openstarry checkpoint ${subcommand} <path>`);
      return 1;
    }

    const resolvedPath = resolve(path);
    if (!existsSync(resolvedPath)) {
      console.error(`Error: checkpoint file not found: ${resolvedPath}`);
      return 1;
    }

    if (subcommand === "inspect") {
      return this.inspect(resolvedPath);
    }
    if (subcommand === "verify") {
      return this.verify(args, resolvedPath);
    }

    console.error(`Unknown subcommand: ${subcommand}`);
    console.error("Supported: verify, inspect");
    return 1;
  }

  private async inspect(path: string): Promise<number> {
    try {
      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const signature = parsed["signature"] as Record<string, unknown> | undefined;
      const payload = parsed["payload"];
      let pluginNames: string[] = [];
      if (typeof payload === "string") {
        try {
          const decoded = JSON.parse(payload) as Record<string, unknown>;
          const snaps = decoded["snapshots"];
          if (Array.isArray(snaps)) {
            pluginNames = (snaps as unknown[])
              .map((entry) => (Array.isArray(entry) && typeof entry[0] === "string" ? entry[0] : null))
              .filter((n): n is string => n !== null);
          }
        } catch {
          // Malformed payload — still show envelope metadata.
        }
      }
      console.log(JSON.stringify({
        path,
        envelopeVersion: parsed["envelopeVersion"],
        createdAt: parsed["createdAt"],
        signature: {
          algorithm: signature?.["algorithm"],
          signedAt: signature?.["signedAt"],
          nonce: signature?.["nonce"],
        },
        plugins: pluginNames,
      }, null, 2));
      return 0;
    } catch (err) {
      console.error(`Error: inspect failed: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  private async verify(args: ParsedArgs, path: string): Promise<number> {
    const key = this.resolveHmacKey(args);
    if (!key) {
      console.error(
        "Error: HMAC key required. Pass --hmac-key <hex> or set " +
        "OPENSTARRY_CHECKPOINT_HMAC_KEY.",
      );
      return 1;
    }
    const result = await readSnapshotStore({ path, key });
    if (!result.ok) {
      console.error(`VERIFY FAIL: ${result.reason}`);
      return 1;
    }
    console.log(JSON.stringify({
      path,
      verified: true,
      createdAt: result.createdAt,
      pluginCount: result.snapshots.size,
      plugins: [...result.snapshots.keys()],
    }, null, 2));
    return 0;
  }

  private resolveHmacKey(args: ParsedArgs): string | null {
    const flag = args.flags["hmac-key"];
    if (typeof flag === "string" && flag.length > 0) return flag;
    const env = process.env["OPENSTARRY_CHECKPOINT_HMAC_KEY"];
    if (env && env.length > 0) return env;
    return null;
  }
}
