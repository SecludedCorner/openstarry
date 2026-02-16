/**
 * CliTestHelper — Spawns CLI processes for E2E testing.
 * Captures stdout/stderr and exit codes for validation.
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ICliTestHelper {
  spawn(args: string[]): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;

  spawnInteractive(
    args: string[],
    inputs: string[],
  ): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}

export function createCliHelper(): ICliTestHelper {
  const CLI_PATH = resolve(__dirname, "../../../dist/bin.js");

  return {
    async spawn(args: string[]): Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }> {
      return new Promise((resolve, reject) => {
        const child = spawn("node", [CLI_PATH, ...args], {
          env: { ...process.env, NODE_ENV: "test" },
        });

        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
        child.stderr?.on("data", (chunk) => (stderr += chunk.toString()));

        child.on("close", (code) => {
          resolve({ exitCode: code ?? 1, stdout, stderr });
        });

        child.on("error", reject);

        // Auto-kill after 10s (safety timeout)
        setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error("CLI process timeout (10s)"));
        }, 10000);
      });
    },

    async spawnInteractive(
      args: string[],
      inputs: string[],
    ): Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }> {
      return new Promise((resolve, reject) => {
        const child = spawn("node", [CLI_PATH, ...args], {
          env: { ...process.env, NODE_ENV: "test" },
        });

        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
        child.stderr?.on("data", (chunk) => (stderr += chunk.toString()));

        // Send inputs with delay
        let inputIndex = 0;
        const sendNextInput = () => {
          if (inputIndex < inputs.length) {
            child.stdin?.write(inputs[inputIndex] + "\n");
            inputIndex++;
            setTimeout(sendNextInput, 100);
          } else {
            child.stdin?.end();
          }
        };
        setTimeout(sendNextInput, 500); // Wait for prompt

        child.on("close", (code) => {
          resolve({ exitCode: code ?? 1, stdout, stderr });
        });

        child.on("error", reject);

        setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error("Interactive CLI timeout (10s)"));
        }, 10000);
      });
    },
  };
}
