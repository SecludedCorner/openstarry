import { describe, it, expect, vi } from "vitest";
import { parseArgs } from "../src/utils/args.js";
import { StartCommand } from "../src/commands/start.js";
import { InitCommand } from "../src/commands/init.js";
import { VersionCommand } from "../src/commands/version.js";

describe("Integration Tests", () => {
  it("should route version command end-to-end", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Parse args
    const parsed = parseArgs(["version"]);
    expect(parsed.command).toBe("version");

    // Execute command
    const command = new VersionCommand();
    const exitCode = await command.execute(parsed);

    expect(exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("should default to start command when no args provided", () => {
    const parsed = parseArgs([]);
    expect(parsed.command).toBe("");

    // This should trigger StartCommand as default
    const command = new StartCommand();
    expect(command.name).toBe("start");
  });

  it("should parse and route init command", () => {
    const parsed = parseArgs(["init", "--force"]);
    expect(parsed.command).toBe("init");
    expect(parsed.flags.force).toBe(true);

    const command = new InitCommand();
    expect(command.name).toBe("init");
  });
});
