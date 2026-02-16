/**
 * Interactive prompts using Node.js readline (no external libraries).
 */

import { createInterface } from "node:readline";
import type { Interface } from "node:readline";

export interface PromptOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/**
 * Ask a question and return the answer.
 */
export async function question(
  prompt: string,
  defaultValue?: string,
  options: PromptOptions = {}
): Promise<string> {
  const rl = createInterface({
    input: options.input ?? process.stdin,
    output: options.output ?? process.stdout,
  });

  const promptText = defaultValue ? `${prompt} (${defaultValue}): ` : `${prompt}: `;

  return new Promise(resolve => {
    rl.question(promptText, answer => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

/**
 * Create a readline interface wrapper for multiple questions.
 */
export class Prompter {
  private rl: Interface;

  constructor(options: PromptOptions = {}) {
    this.rl = createInterface({
      input: options.input ?? process.stdin,
      output: options.output ?? process.stdout,
    });
  }

  async ask(prompt: string, defaultValue?: string): Promise<string> {
    const promptText = defaultValue ? `${prompt} (${defaultValue}): ` : `${prompt}: `;

    return new Promise(resolve => {
      this.rl.question(promptText, answer => {
        resolve(answer.trim() || defaultValue || "");
      });
    });
  }

  close(): void {
    this.rl.close();
  }
}
