import { describe, it, expect } from "vitest";
import { Readable, Writable } from "node:stream";
import { question, Prompter } from "../../src/utils/prompts.js";

// Create mock stdin/stdout
function createMockStreams(inputs: string[]): {
  input: Readable;
  output: Writable;
  outputData: string[];
} {
  const outputData: string[] = [];

  const input = new Readable({
    read() {
      if (inputs.length > 0) {
        this.push(inputs.shift() + "\n");
      } else {
        this.push(null);
      }
    },
  });

  const output = new Writable({
    write(chunk, _encoding, callback) {
      outputData.push(chunk.toString());
      callback();
    },
  });

  return { input, output, outputData };
}

describe("question", () => {
  it("should return user input", async () => {
    const { input, output } = createMockStreams(["test-answer"]);
    const result = await question("Enter value", undefined, { input, output });
    expect(result).toBe("test-answer");
  });

  it("should use default value when input is empty", async () => {
    const { input, output } = createMockStreams([""]);
    const result = await question("Enter value", "default-value", { input, output });
    expect(result).toBe("default-value");
  });

  it("should trim whitespace from input", async () => {
    const { input, output } = createMockStreams(["  test  "]);
    const result = await question("Enter value", undefined, { input, output });
    expect(result).toBe("test");
  });

  it("should display default value in prompt", async () => {
    const { input, output, outputData } = createMockStreams([""]);
    await question("Enter value", "default", { input, output });
    expect(outputData.join("")).toContain("(default)");
  });

  it("should handle empty input without default", async () => {
    const { input, output } = createMockStreams([""]);
    const result = await question("Enter value", undefined, { input, output });
    expect(result).toBe("");
  });
});

describe("Prompter", () => {
  it("should ask a question", async () => {
    const { input, output } = createMockStreams(["answer1"]);
    const prompter = new Prompter({ input, output });

    const result = await prompter.ask("Question 1");

    expect(result).toBe("answer1");

    prompter.close();
  });

  it("should use default value when input is empty", async () => {
    const { input, output } = createMockStreams([""]);
    const prompter = new Prompter({ input, output });

    const result = await prompter.ask("Question 1", "default1");

    expect(result).toBe("default1");

    prompter.close();
  });

  it("should trim answers", async () => {
    const { input, output } = createMockStreams(["  trimmed  "]);
    const prompter = new Prompter({ input, output });

    const result = await prompter.ask("Question");
    expect(result).toBe("trimmed");

    prompter.close();
  });

  it("should close cleanly", () => {
    const { input, output } = createMockStreams([]);
    const prompter = new Prompter({ input, output });

    expect(() => prompter.close()).not.toThrow();
  });
});
