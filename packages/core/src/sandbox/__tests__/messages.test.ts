import { describe, it, expect } from "vitest";
import type {
  SandboxMessage,
  InitPluginMessage,
  InvokeToolMessage,
  BusEmitMessage,
  PushInputMessage,
  ShutdownMessage,
  HeartbeatMessage,
  SerializedPluginContext,
  SerializedPluginHooks,
} from "../messages.js";

describe("SandboxMessage types", () => {
  it("InitPluginMessage is valid", () => {
    const msg: InitPluginMessage = {
      type: "INIT_PLUGIN",
      id: "req-1",
      payload: {
        pluginPath: "some-plugin/test",
        config: { key: "value" },
        context: {
          workingDirectory: "/home/user",
          agentId: "agent-1",
          config: { key: "value" },
        },
      },
    };
    expect(msg.type).toBe("INIT_PLUGIN");
    expect(msg.payload.pluginPath).toBe("some-plugin/test");
  });

  it("InvokeToolMessage is valid", () => {
    const msg: InvokeToolMessage = {
      type: "INVOKE_TOOL",
      id: "req-2",
      payload: {
        toolId: "fs.read",
        input: { path: "/tmp/file.txt" },
        context: {
          workingDirectory: "/home/user",
          allowedPaths: ["/home/user"],
        },
      },
    };
    expect(msg.type).toBe("INVOKE_TOOL");
    expect(msg.payload.toolId).toBe("fs.read");
  });

  it("BusEmitMessage serializes events correctly", () => {
    const msg: BusEmitMessage = {
      type: "BUS_EMIT",
      payload: {
        event: {
          type: "tool:result",
          timestamp: Date.now(),
          payload: { result: "success" },
        },
      },
    };
    expect(msg.payload.event.type).toBe("tool:result");
  });

  it("PushInputMessage serializes input events", () => {
    const msg: PushInputMessage = {
      type: "PUSH_INPUT",
      payload: {
        inputEvent: {
          source: "mcp",
          inputType: "user_input",
          data: "hello",
          replyTo: "reply-1",
          sessionId: "session-1",
        },
      },
    };
    expect(msg.payload.inputEvent.source).toBe("mcp");
    expect(msg.payload.inputEvent.sessionId).toBe("session-1");
  });

  it("ShutdownMessage has no payload", () => {
    const msg: ShutdownMessage = { type: "SHUTDOWN" };
    expect(msg.type).toBe("SHUTDOWN");
  });

  it("HeartbeatMessage has timestamp", () => {
    const now = Date.now();
    const msg: HeartbeatMessage = {
      type: "HEARTBEAT",
      payload: { timestamp: now },
    };
    expect(msg.payload.timestamp).toBe(now);
  });

  it("SerializedPluginContext is JSON-serializable", () => {
    const ctx: SerializedPluginContext = {
      workingDirectory: "/home/user",
      agentId: "agent-1",
      config: { nested: { deep: true } },
    };
    const json = JSON.parse(JSON.stringify(ctx));
    expect(json.workingDirectory).toBe("/home/user");
    expect(json.config.nested.deep).toBe(true);
  });

  it("SerializedPluginHooks represents all hook types", () => {
    const hooks: SerializedPluginHooks = {
      tools: [{ id: "tool-1", description: "Test tool" }],
      providers: [{ id: "provider-1", name: "Test Provider" }],
      listeners: [{ name: "Test Listener" }],
      ui: [{ id: "ui-1" }],
      guides: [{ id: "guide-1", name: "Test Guide" }],
      commands: [{ name: "test-cmd", description: "Test command" }],
    };
    expect(hooks.tools).toHaveLength(1);
    expect(hooks.providers).toHaveLength(1);
    expect(hooks.listeners).toHaveLength(1);
    expect(hooks.ui).toHaveLength(1);
    expect(hooks.guides).toHaveLength(1);
    expect(hooks.commands).toHaveLength(1);
  });

  it("SandboxMessage union type accepts all message types", () => {
    const messages: SandboxMessage[] = [
      { type: "INIT_PLUGIN", id: "1", payload: { pluginPath: "test", config: {}, context: { workingDirectory: "", agentId: "", config: {} } } },
      { type: "INIT_COMPLETE", payload: { success: true, hooks: {} } },
      { type: "INVOKE_TOOL", id: "2", payload: { toolId: "x", input: {}, context: { workingDirectory: "", allowedPaths: [] } } },
      { type: "TOOL_RESULT", replyTo: "2", payload: { success: true, result: "ok" } },
      { type: "BUS_EMIT", payload: { event: { type: "test", timestamp: 0 } } },
      { type: "PUSH_INPUT", payload: { inputEvent: { source: "a", inputType: "b", data: "c" } } },
      { type: "SHUTDOWN" },
      { type: "HEARTBEAT", payload: { timestamp: 0 } },
    ];
    expect(messages).toHaveLength(8);
  });

  it("all messages are JSON-serializable (no functions or circular refs)", () => {
    const messages: SandboxMessage[] = [
      { type: "INIT_PLUGIN", id: "1", payload: { pluginPath: "test", config: {}, context: { workingDirectory: "", agentId: "", config: {} } } },
      { type: "TOOL_RESULT", replyTo: "1", payload: { success: true, result: "data" } },
      { type: "HEARTBEAT", payload: { timestamp: Date.now() } },
    ];

    for (const msg of messages) {
      const serialized = JSON.stringify(msg);
      const deserialized = JSON.parse(serialized);
      expect(deserialized.type).toBe(msg.type);
    }
  });
});
