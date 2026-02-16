import { describe, it, expect, vi } from "vitest";
import { VersionCommand } from "../../src/commands/version.js";
import type { ParsedArgs } from "../../src/commands/base.js";

describe("VersionCommand", () => {
  it("should display version", async () => {
    const command = new VersionCommand();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const args: ParsedArgs = {
      command: "version",
      flags: {},
      positional: [],
    };

    const exitCode = await command.execute(args);

    expect(exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("OpenStarry v"));
    consoleSpy.mockRestore();
  });

  it("should display verbose information when --verbose flag is set", async () => {
    const command = new VersionCommand();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const args: ParsedArgs = {
      command: "version",
      flags: { verbose: true },
      positional: [],
    };

    await command.execute(args);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Node.js"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Platform:"));
    consoleSpy.mockRestore();
  });

  it("should not display verbose information without --verbose flag", async () => {
    const command = new VersionCommand();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const args: ParsedArgs = {
      command: "version",
      flags: {},
      positional: [],
    };

    await command.execute(args);

    const calls = consoleSpy.mock.calls.map(call => call.join(" "));
    const allOutput = calls.join("\n");

    expect(allOutput).not.toContain("Node.js");
    expect(allOutput).not.toContain("Platform:");
    consoleSpy.mockRestore();
  });
});
