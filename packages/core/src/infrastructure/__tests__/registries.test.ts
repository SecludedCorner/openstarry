import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { ITool, IProvider, IListener, IGuide, IUI, SlashCommand, IPluginContext, ModelInfo, ProviderStreamEvent } from "@openstarry/sdk";
import { createToolRegistry } from "../tool-registry.js";
import { createProviderRegistry } from "../provider-registry.js";
import { createListenerRegistry } from "../listener-registry.js";
import { createGuideRegistry } from "../guide-registry.js";
import { createUIRegistry } from "../ui-registry.js";
import { createCommandRegistry } from "../command-registry.js";

describe("ToolRegistry", () => {
  it("registers and retrieves a tool by id", () => {
    const registry = createToolRegistry();
    const tool: ITool = {
      id: "test-tool",
      description: "A test tool",
      parameters: z.object({}),
      execute: vi.fn(),
    };

    registry.register(tool);
    const retrieved = registry.get("test-tool");
    expect(retrieved).toBe(tool);
  });

  it("returns undefined for non-existent tool", () => {
    const registry = createToolRegistry();
    const result = registry.get("non-existent");
    expect(result).toBeUndefined();
  });

  it("lists all registered tools", () => {
    const registry = createToolRegistry();
    const tool1: ITool = {
      id: "tool-1",
      description: "Tool 1",
      parameters: z.object({}),
      execute: vi.fn(),
    };
    const tool2: ITool = {
      id: "tool-2",
      description: "Tool 2",
      parameters: z.object({}),
      execute: vi.fn(),
    };

    registry.register(tool1);
    registry.register(tool2);
    const list = registry.list();

    expect(list).toHaveLength(2);
    expect(list).toContain(tool1);
    expect(list).toContain(tool2);
  });

  it("converts tools to JSON schemas", () => {
    const registry = createToolRegistry();
    const tool: ITool = {
      id: "schema-tool",
      description: "A tool for schema testing",
      parameters: z.object({ name: z.string() }),
      execute: vi.fn(),
    };

    registry.register(tool);
    const schemas = registry.toJsonSchemas();

    expect(schemas).toHaveLength(1);
    expect(schemas[0].name).toBe("schema-tool");
    expect(schemas[0].description).toBe("A tool for schema testing");
    expect(schemas[0].parameters).toHaveProperty("type", "object");
  });

  it("handles multiple tools in toJsonSchemas", () => {
    const registry = createToolRegistry();
    const tool1: ITool = {
      id: "tool-a",
      description: "Tool A",
      parameters: z.object({}),
      execute: vi.fn(),
    };
    const tool2: ITool = {
      id: "tool-b",
      description: "Tool B",
      parameters: z.object({}),
      execute: vi.fn(),
    };

    registry.register(tool1);
    registry.register(tool2);
    const schemas = registry.toJsonSchemas();

    expect(schemas).toHaveLength(2);
    expect(schemas.map(s => s.name)).toEqual(["tool-a", "tool-b"]);
  });
});

describe("ProviderRegistry", () => {
  it("registers and retrieves a provider by id", () => {
    const registry = createProviderRegistry();
    const provider: IProvider = {
      id: "test-provider",
      name: "Test Provider",
      models: [],
      chat: vi.fn(),
    };

    registry.register(provider);
    const retrieved = registry.get("test-provider");
    expect(retrieved).toBe(provider);
  });

  it("returns undefined for non-existent provider", () => {
    const registry = createProviderRegistry();
    const result = registry.get("non-existent");
    expect(result).toBeUndefined();
  });

  it("lists all registered providers", () => {
    const registry = createProviderRegistry();
    const provider1: IProvider = {
      id: "provider-1",
      name: "Provider 1",
      models: [],
      chat: vi.fn(),
    };
    const provider2: IProvider = {
      id: "provider-2",
      name: "Provider 2",
      models: [],
      chat: vi.fn(),
    };

    registry.register(provider1);
    registry.register(provider2);
    const list = registry.list();

    expect(list).toHaveLength(2);
    expect(list).toContain(provider1);
    expect(list).toContain(provider2);
  });

  it("resolves a model to its provider", () => {
    const registry = createProviderRegistry();
    const model1: ModelInfo = { id: "model-a", name: "Model A" };
    const model2: ModelInfo = { id: "model-b", name: "Model B" };
    const provider: IProvider = {
      id: "test-provider",
      name: "Test Provider",
      models: [model1, model2],
      chat: vi.fn(),
    };

    registry.register(provider);
    const result = registry.resolveModel("model-b");

    expect(result).toBeDefined();
    expect(result?.provider).toBe(provider);
    expect(result?.model).toBe(model2);
  });

  it("returns undefined when resolving non-existent model", () => {
    const registry = createProviderRegistry();
    const provider: IProvider = {
      id: "test-provider",
      name: "Test Provider",
      models: [{ id: "model-a", name: "Model A" }],
      chat: vi.fn(),
    };

    registry.register(provider);
    const result = registry.resolveModel("non-existent");
    expect(result).toBeUndefined();
  });

  it("resolves model across multiple providers", () => {
    const registry = createProviderRegistry();
    const provider1: IProvider = {
      id: "provider-1",
      name: "Provider 1",
      models: [{ id: "model-1", name: "Model 1" }],
      chat: vi.fn(),
    };
    const provider2: IProvider = {
      id: "provider-2",
      name: "Provider 2",
      models: [{ id: "model-2", name: "Model 2" }],
      chat: vi.fn(),
    };

    registry.register(provider1);
    registry.register(provider2);
    const result = registry.resolveModel("model-2");

    expect(result?.provider).toBe(provider2);
    expect(result?.model.id).toBe("model-2");
  });
});

describe("ListenerRegistry", () => {
  it("registers and retrieves a listener by id", () => {
    const registry = createListenerRegistry();
    const listener: IListener = {
      id: "test-listener",
      name: "Test Listener",
    };

    registry.register(listener);
    const retrieved = registry.get("test-listener");
    expect(retrieved).toBe(listener);
  });

  it("returns undefined for non-existent listener", () => {
    const registry = createListenerRegistry();
    const result = registry.get("non-existent");
    expect(result).toBeUndefined();
  });

  it("lists all registered listeners", () => {
    const registry = createListenerRegistry();
    const listener1: IListener = {
      id: "listener-1",
      name: "Listener 1",
    };
    const listener2: IListener = {
      id: "listener-2",
      name: "Listener 2",
      start: vi.fn(),
      stop: vi.fn(),
    };

    registry.register(listener1);
    registry.register(listener2);
    const list = registry.list();

    expect(list).toHaveLength(2);
    expect(list).toContain(listener1);
    expect(list).toContain(listener2);
  });

  it("handles listeners with optional start/stop methods", () => {
    const registry = createListenerRegistry();
    const listener: IListener = {
      id: "minimal-listener",
      name: "Minimal Listener",
    };

    registry.register(listener);
    const retrieved = registry.get("minimal-listener");
    expect(retrieved?.start).toBeUndefined();
    expect(retrieved?.stop).toBeUndefined();
  });
});

describe("GuideRegistry", () => {
  it("registers and retrieves a guide by id", () => {
    const registry = createGuideRegistry();
    const guide: IGuide = {
      id: "test-guide",
      name: "Test Guide",
      getSystemPrompt: () => "Test prompt",
    };

    registry.register(guide);
    const retrieved = registry.get("test-guide");
    expect(retrieved).toBe(guide);
  });

  it("returns undefined for non-existent guide", () => {
    const registry = createGuideRegistry();
    const result = registry.get("non-existent");
    expect(result).toBeUndefined();
  });

  it("lists all registered guides", () => {
    const registry = createGuideRegistry();
    const guide1: IGuide = {
      id: "guide-1",
      name: "Guide 1",
      getSystemPrompt: () => "Prompt 1",
    };
    const guide2: IGuide = {
      id: "guide-2",
      name: "Guide 2",
      getSystemPrompt: async () => "Prompt 2",
    };

    registry.register(guide1);
    registry.register(guide2);
    const list = registry.list();

    expect(list).toHaveLength(2);
    expect(list).toContain(guide1);
    expect(list).toContain(guide2);
  });

  it("handles guides with sync and async getSystemPrompt", () => {
    const registry = createGuideRegistry();
    const syncGuide: IGuide = {
      id: "sync-guide",
      name: "Sync Guide",
      getSystemPrompt: () => "Sync prompt",
    };
    const asyncGuide: IGuide = {
      id: "async-guide",
      name: "Async Guide",
      getSystemPrompt: async () => "Async prompt",
    };

    registry.register(syncGuide);
    registry.register(asyncGuide);
    expect(registry.get("sync-guide")).toBe(syncGuide);
    expect(registry.get("async-guide")).toBe(asyncGuide);
  });
});

describe("UIRegistry", () => {
  it("registers and retrieves a UI by id", () => {
    const registry = createUIRegistry();
    const ui: IUI = {
      id: "test-ui",
      name: "Test UI",
      onEvent: vi.fn(),
    };

    registry.register(ui);
    const retrieved = registry.get("test-ui");
    expect(retrieved).toBe(ui);
  });

  it("returns undefined for non-existent UI", () => {
    const registry = createUIRegistry();
    const result = registry.get("non-existent");
    expect(result).toBeUndefined();
  });

  it("lists all registered UIs", () => {
    const registry = createUIRegistry();
    const ui1: IUI = {
      id: "ui-1",
      name: "UI 1",
      onEvent: vi.fn(),
    };
    const ui2: IUI = {
      id: "ui-2",
      name: "UI 2",
      onEvent: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };

    registry.register(ui1);
    registry.register(ui2);
    const list = registry.list();

    expect(list).toHaveLength(2);
    expect(list).toContain(ui1);
    expect(list).toContain(ui2);
  });

  it("handles UIs with optional start/stop methods", () => {
    const registry = createUIRegistry();
    const ui: IUI = {
      id: "minimal-ui",
      name: "Minimal UI",
      onEvent: vi.fn(),
    };

    registry.register(ui);
    const retrieved = registry.get("minimal-ui");
    expect(retrieved?.start).toBeUndefined();
    expect(retrieved?.stop).toBeUndefined();
  });
});

describe("CommandRegistry", () => {
  it("registers and retrieves a command by name", () => {
    const registry = createCommandRegistry();
    const command: SlashCommand = {
      name: "test",
      description: "Test command",
      execute: vi.fn(),
    };

    registry.register(command);
    const retrieved = registry.get("test");
    expect(retrieved).toBe(command);
  });

  it("returns undefined for non-existent command", () => {
    const registry = createCommandRegistry();
    const result = registry.get("non-existent");
    expect(result).toBeUndefined();
  });

  it("lists all registered commands", () => {
    const registry = createCommandRegistry();
    const command1: SlashCommand = {
      name: "cmd1",
      description: "Command 1",
      execute: vi.fn(),
    };
    const command2: SlashCommand = {
      name: "cmd2",
      description: "Command 2",
      execute: vi.fn(),
    };

    registry.register(command1);
    registry.register(command2);
    const list = registry.list();

    expect(list).toHaveLength(2);
    expect(list).toContain(command1);
    expect(list).toContain(command2);
  });

  it("executes a registered command", async () => {
    const registry = createCommandRegistry();
    const executeFn = vi.fn().mockResolvedValue("Command result");
    const command: SlashCommand = {
      name: "exec-test",
      description: "Execution test",
      execute: executeFn,
    };

    registry.register(command);
    const mockCtx = {} as IPluginContext;
    const result = await registry.execute("exec-test", "arg1 arg2", mockCtx);

    expect(executeFn).toHaveBeenCalledWith("arg1 arg2", mockCtx, undefined);
    expect(result).toBe("Command result");
  });

  it("returns undefined when executing non-existent command", async () => {
    const registry = createCommandRegistry();
    const mockCtx = {} as IPluginContext;
    const result = await registry.execute("non-existent", "args", mockCtx);
    expect(result).toBeUndefined();
  });

  it("passes correct arguments to command execute", async () => {
    const registry = createCommandRegistry();
    const executeFn = vi.fn().mockResolvedValue("OK");
    const command: SlashCommand = {
      name: "test",
      description: "Test",
      execute: executeFn,
    };

    registry.register(command);
    const mockCtx = { agentId: "agent-1" } as IPluginContext;
    await registry.execute("test", "some arguments", mockCtx);

    expect(executeFn).toHaveBeenCalledTimes(1);
    expect(executeFn).toHaveBeenCalledWith("some arguments", mockCtx, undefined);
  });

  it("passes sessionId to command execute", async () => {
    const registry = createCommandRegistry();
    const executeFn = vi.fn().mockResolvedValue("OK");
    const command: SlashCommand = {
      name: "session-test",
      description: "Session test",
      execute: executeFn,
    };

    registry.register(command);
    const mockCtx = {} as IPluginContext;
    const validSessionId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    await registry.execute("session-test", "args", mockCtx, validSessionId);

    expect(executeFn).toHaveBeenCalledWith("args", mockCtx, validSessionId);
  });

  it("rejects invalid sessionId format (SEC-032-002)", async () => {
    const registry = createCommandRegistry();
    const executeFn = vi.fn().mockResolvedValue("OK");
    const command: SlashCommand = {
      name: "sec-test",
      description: "Security test",
      execute: executeFn,
    };

    registry.register(command);
    const mockCtx = {} as IPluginContext;
    const result = await registry.execute("sec-test", "args", mockCtx, "invalid-session-id");

    expect(result).toBeUndefined();
    expect(executeFn).not.toHaveBeenCalled();
  });
});
