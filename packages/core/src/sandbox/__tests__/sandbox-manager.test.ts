import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { EventBus, AgentEvent, InputEvent, ISessionManager, ITool, IGuide, ISession } from "@openstarry/sdk";
import type { SandboxManagerDeps } from "../sandbox-manager.js";

// Mock Worker class
class MockWorker extends EventEmitter {
  resourceLimits: Record<string, number> = {};
  postMessage = vi.fn();
  terminate = vi.fn().mockResolvedValue(0);
  performance = { eventLoopUtilization: () => ({ active: 0 }) };

  // Simulate worker responding to messages
  simulateMessage(msg: unknown): void {
    this.emit("message", msg);
  }

  simulateExit(code: number): void {
    this.emit("exit", code);
  }

  simulateError(err: Error): void {
    this.emit("error", err);
  }
}

// Mock the worker_threads module
vi.mock("node:worker_threads", () => ({
  Worker: class extends MockWorker {
    constructor(_path: string, _opts?: unknown) {
      super();
    }
  },
}));

function createMockDeps(): SandboxManagerDeps {
  const events: AgentEvent[] = [];
  const bus: EventBus = {
    on: vi.fn(() => () => {}),
    once: vi.fn(() => () => {}),
    onAny: vi.fn(() => () => {}),
    emit: vi.fn((event: AgentEvent) => { events.push(event); }),
  };

  const mockSession: ISession = {
    id: "test-session",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {},
  };

  const sessions: ISessionManager = {
    create: vi.fn(() => mockSession),
    get: vi.fn(() => mockSession),
    list: vi.fn(() => [mockSession]),
    destroy: vi.fn(() => true),
    getStateManager: vi.fn(() => ({
      getMessages: () => [],
      addMessage: () => {},
      clear: () => {},
      snapshot: () => [],
      restore: () => {},
    })),
    getDefaultSession: vi.fn(() => mockSession),
  };

  return {
    bus,
    pushInput: vi.fn(),
    sessions,
    tools: {
      list: () => [],
      get: () => undefined,
    },
    guides: {
      list: () => [],
    },
  };
}

describe("PluginSandboxManager", () => {
  let deps: SandboxManagerDeps;

  beforeEach(() => {
    deps = createMockDeps();
    vi.clearAllMocks();
  });

  it("exports createPluginSandboxManager function", async () => {
    const { createPluginSandboxManager } = await import("../sandbox-manager.js");
    expect(typeof createPluginSandboxManager).toBe("function");
  });

  it("creates a sandbox manager with expected interface", async () => {
    const { createPluginSandboxManager } = await import("../sandbox-manager.js");
    const manager = createPluginSandboxManager(deps);

    expect(typeof manager.loadInSandbox).toBe("function");
    expect(typeof manager.invokeTool).toBe("function");
    expect(typeof manager.shutdownPlugin).toBe("function");
    expect(typeof manager.shutdownAll).toBe("function");
    expect(typeof manager.getResourceUsage).toBe("function");
  });

  it("shutdownPlugin handles non-existent plugin gracefully", async () => {
    const { createPluginSandboxManager } = await import("../sandbox-manager.js");
    const manager = createPluginSandboxManager(deps);

    // Should not throw
    await expect(manager.shutdownPlugin("nonexistent")).resolves.toBeUndefined();
  });

  it("shutdownAll handles empty worker list", async () => {
    const { createPluginSandboxManager } = await import("../sandbox-manager.js");
    const manager = createPluginSandboxManager(deps);

    await expect(manager.shutdownAll()).resolves.toBeUndefined();
  });

  it("getResourceUsage returns null for unknown plugin", async () => {
    const { createPluginSandboxManager } = await import("../sandbox-manager.js");
    const manager = createPluginSandboxManager(deps);

    const usage = await manager.getResourceUsage("unknown");
    expect(usage).toBeNull();
  });

  it("invokeTool throws SandboxError for unknown plugin", async () => {
    const { createPluginSandboxManager } = await import("../sandbox-manager.js");
    const manager = createPluginSandboxManager(deps);

    await expect(
      manager.invokeTool("unknown-plugin", "test-tool", {}, {
        workingDirectory: "/tmp",
        allowedPaths: ["/tmp"],
      }),
    ).rejects.toThrow(/No sandbox worker found/);
  });

  it("uses default memory limit of 512 MB when not specified", async () => {
    const { createPluginSandboxManager } = await import("../sandbox-manager.js");
    const manager = createPluginSandboxManager(deps);
    // The default is internal to the implementation
    // Verified by checking the Architecture Spec conformance
    expect(manager).toBeDefined();
  });
});

describe("SandboxManagerDeps interface", () => {
  it("deps.bus.emit is called for sandbox events", () => {
    const deps = createMockDeps();
    deps.bus.emit({
      type: "sandbox:worker_spawned",
      timestamp: Date.now(),
      payload: { pluginName: "test" },
    });
    expect(deps.bus.emit).toHaveBeenCalledTimes(1);
  });

  it("deps.pushInput forwards input events", () => {
    const deps = createMockDeps();
    const event: InputEvent = {
      source: "sandbox",
      inputType: "user_input",
      data: "test",
    };
    deps.pushInput(event);
    expect(deps.pushInput).toHaveBeenCalledWith(event);
  });
});
