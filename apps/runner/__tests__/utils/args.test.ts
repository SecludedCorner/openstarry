import { describe, it, expect } from "vitest";
import { parseArgs } from "../../src/utils/args.js";

describe("parseArgs", () => {
  it("should parse start command with config flag", () => {
    const result = parseArgs(["start", "--config", "./agent.json"]);
    expect(result).toEqual({
      command: "start",
      flags: { config: "./agent.json" },
      positional: [],
    });
  });

  it("should parse init command with force flag", () => {
    const result = parseArgs(["init", "--force"]);
    expect(result).toEqual({
      command: "init",
      flags: { force: true },
      positional: [],
    });
  });

  it("should parse version command with verbose flag", () => {
    const result = parseArgs(["version", "--verbose"]);
    expect(result).toEqual({
      command: "version",
      flags: { verbose: true },
      positional: [],
    });
  });

  it("should parse no command (defaults to empty string)", () => {
    const result = parseArgs(["--verbose"]);
    expect(result).toEqual({
      command: "",
      flags: { verbose: true },
      positional: [],
    });
  });

  it("should parse boolean flags", () => {
    const result = parseArgs(["start", "--verbose", "--force"]);
    expect(result).toEqual({
      command: "start",
      flags: { verbose: true, force: true },
      positional: [],
    });
  });

  it("should parse flags with values", () => {
    const result = parseArgs(["start", "--config", "./path", "--log-level", "debug"]);
    expect(result).toEqual({
      command: "start",
      flags: { config: "./path", "log-level": "debug" },
      positional: [],
    });
  });

  it("should parse positional arguments", () => {
    const result = parseArgs(["start", "arg1", "arg2"]);
    expect(result).toEqual({
      command: "start",
      flags: {},
      positional: ["arg1", "arg2"],
    });
  });

  it("should parse mixed flags and positional", () => {
    // Note: parser treats --flag as taking next arg if it doesn't start with -
    // So order matters: put boolean flags at end or use positionals first
    const result = parseArgs(["start", "arg1", "arg2", "--verbose", "--config", "./path"]);
    expect(result).toEqual({
      command: "start",
      flags: { verbose: true, config: "./path" },
      positional: ["arg1", "arg2"],
    });
  });

  it("should preserve unknown flags", () => {
    const result = parseArgs(["start", "--unknown", "value"]);
    expect(result).toEqual({
      command: "start",
      flags: { unknown: "value" },
      positional: [],
    });
  });

  it("should parse empty argv", () => {
    const result = parseArgs([]);
    expect(result).toEqual({
      command: "",
      flags: {},
      positional: [],
    });
  });

  it("should parse short flags", () => {
    const result = parseArgs(["-v", "-f"]);
    expect(result).toEqual({
      command: "",
      flags: { v: true, f: true },
      positional: [],
    });
  });
});
