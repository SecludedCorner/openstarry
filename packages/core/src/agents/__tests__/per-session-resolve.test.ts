/**
 * Per-session model/provider resolution tests.
 *
 * Verifies the full chain:
 *   session model → global model → config.cognition.model
 *   session provider → global provider → config.cognition.provider
 */

import { describe, it, expect, vi } from "vitest";
import type { IProvider, IAgentConfig, ProviderStreamEvent, IPluginContext, ICognitionConfigService } from "@openstarry/sdk";
import { AgentEventType, getSessionConfig, setSessionConfig } from "@openstarry/sdk";
import { createAgentCore } from "../agent-core.js";

const createMockProvider = (id: string, modelIds: string[]): IProvider => ({
  id,
  name: `Provider ${id}`,
  models: modelIds.map((m) => ({ id: m, name: m })),
  chat: vi.fn(async function* (): AsyncGenerator<ProviderStreamEvent> {
    yield { type: "text_delta", text: `response from ${id}` } as ProviderStreamEvent;
    yield { type: "finish", stopReason: "end_turn", usage: { totalTokens: 5 } } as unknown as ProviderStreamEvent;
  }),
});

function createTestConfig(overrides?: Partial<IAgentConfig["cognition"]>): IAgentConfig {
  return {
    identity: { id: "test-agent", name: "Test Agent" },
    plugins: [],
    cognition: {
      provider: "default-provider",
      model: "default-model",
      ...overrides,
    },
    capabilities: {},
  };
}

/**
 * Create a mock cognition-config service plugin that registers the service.
 * Mimics what standard-model-selector does, but self-contained for Core tests.
 */
function createCognitionConfigPlugin() {
  let globalModel: string | undefined;
  let globalProvider: string | undefined;

  return {
    manifest: {
      name: "test-cognition-config",
      version: "1.0.0",
      services: ["cognition-config"],
      sandbox: { enabled: false },
    },
    factory: async (ctx: IPluginContext) => {
      const svc: ICognitionConfigService = {
        name: "cognition-config",
        version: "1.0.0",
        getModel(sessionId?: string): string | undefined {
          if (sessionId) {
            const session = ctx.sessions.get(sessionId);
            if (session) {
              const cfg = getSessionConfig(session.metadata);
              if (cfg?.model) return cfg.model as string;
            }
          }
          return globalModel;
        },
        setModel(modelId: string, sessionId?: string): void {
          if (sessionId) {
            const session = ctx.sessions.get(sessionId);
            if (session) {
              const cfg = getSessionConfig(session.metadata) ?? {};
              cfg.model = modelId;
              setSessionConfig(session.metadata, cfg);
              return;
            }
          }
          globalModel = modelId;
        },
        getProvider(sessionId?: string): string | undefined {
          if (sessionId) {
            const session = ctx.sessions.get(sessionId);
            if (session) {
              const cfg = getSessionConfig(session.metadata);
              if (cfg?.provider) return cfg.provider as string;
            }
          }
          return globalProvider;
        },
        setProvider(providerId: string, sessionId?: string): void {
          if (sessionId) {
            const session = ctx.sessions.get(sessionId);
            if (session) {
              const cfg = getSessionConfig(session.metadata) ?? {};
              cfg.provider = providerId;
              setSessionConfig(session.metadata, cfg);
              return;
            }
          }
          globalProvider = providerId;
        },
      };
      ctx.services?.register(svc);
      return {};
    },
  };
}

describe("Per-session model/provider resolution", () => {
  it("falls back to config.cognition.model when no cognition-config service", async () => {
    const config = createTestConfig({ model: "config-model" });
    const core = createAgentCore(config);

    const provider = createMockProvider("default-provider", ["config-model"]);
    core.providerRegistry.register(provider);

    const events: Array<{ type: string; payload?: unknown }> = [];
    core.bus.on(AgentEventType.LOOP_AWAITING_LLM, (e) => events.push(e));

    await core.start();
    core.pushInput({ source: "test", inputType: "user_input", data: "hello" });

    await new Promise((r) => setTimeout(r, 200));
    await core.stop();

    const llmEvent = events.find((e) => e.type === AgentEventType.LOOP_AWAITING_LLM);
    expect(llmEvent).toBeDefined();
    expect((llmEvent!.payload as Record<string, unknown>).model).toBe("config-model");
  });

  it("cognition-config service global model overrides config.cognition.model", async () => {
    const config = createTestConfig({ model: "config-model" });
    const core = createAgentCore(config);

    const provider = createMockProvider("p1", ["config-model", "runtime-model"]);
    core.providerRegistry.register(provider);

    await core.loadPlugin(createCognitionConfigPlugin());

    const cogSvc = core.serviceRegistry.get<ICognitionConfigService>("cognition-config")!;
    cogSvc.setModel("runtime-model");

    const events: Array<{ type: string; payload?: unknown }> = [];
    core.bus.on(AgentEventType.LOOP_AWAITING_LLM, (e) => events.push(e));

    await core.start();
    core.pushInput({ source: "test", inputType: "user_input", data: "hello" });

    await new Promise((r) => setTimeout(r, 200));
    await core.stop();

    const llmEvent = events.find((e) => e.type === AgentEventType.LOOP_AWAITING_LLM);
    expect(llmEvent).toBeDefined();
    expect((llmEvent!.payload as Record<string, unknown>).model).toBe("runtime-model");
  });

  it("per-session model overrides global model", async () => {
    const config = createTestConfig({ model: "config-model" });
    const core = createAgentCore(config);

    const provider = createMockProvider("p1", ["config-model", "global-model", "session-model"]);
    core.providerRegistry.register(provider);

    await core.loadPlugin(createCognitionConfigPlugin());

    const cogSvc = core.serviceRegistry.get<ICognitionConfigService>("cognition-config")!;
    cogSvc.setModel("global-model");

    const session = core.sessionManager.create();
    cogSvc.setModel("session-model", session.id);

    // Verify service-level correctness
    expect(cogSvc.getModel()).toBe("global-model");
    expect(cogSvc.getModel(session.id)).toBe("session-model");

    // Verify end-to-end: push event with sessionId
    const events: Array<{ type: string; payload?: unknown }> = [];
    core.bus.on(AgentEventType.LOOP_AWAITING_LLM, (e) => events.push(e));

    await core.start();
    core.pushInput({ source: "test", inputType: "user_input", data: "hello", sessionId: session.id });

    await new Promise((r) => setTimeout(r, 200));
    await core.stop();

    const llmEvent = events.find((e) => e.type === AgentEventType.LOOP_AWAITING_LLM);
    expect(llmEvent).toBeDefined();
    expect((llmEvent!.payload as Record<string, unknown>).model).toBe("session-model");
  });

  it("two sessions use independent models in successive events", async () => {
    const config = createTestConfig({ model: "config-model" });
    const core = createAgentCore(config);

    const provider = createMockProvider("p1", ["config-model", "model-A", "model-B"]);
    core.providerRegistry.register(provider);

    await core.loadPlugin(createCognitionConfigPlugin());

    const cogSvc = core.serviceRegistry.get<ICognitionConfigService>("cognition-config")!;

    const s1 = core.sessionManager.create();
    const s2 = core.sessionManager.create();
    cogSvc.setModel("model-A", s1.id);
    cogSvc.setModel("model-B", s2.id);

    const models: string[] = [];
    core.bus.on(AgentEventType.LOOP_AWAITING_LLM, (e) => {
      models.push((e.payload as Record<string, unknown>).model as string);
    });

    await core.start();

    core.pushInput({ source: "test", inputType: "user_input", data: "msg1", sessionId: s1.id });
    await new Promise((r) => setTimeout(r, 300));

    core.pushInput({ source: "test", inputType: "user_input", data: "msg2", sessionId: s2.id });
    await new Promise((r) => setTimeout(r, 300));

    await core.stop();

    expect(models).toHaveLength(2);
    expect(models[0]).toBe("model-A");
    expect(models[1]).toBe("model-B");
  });

  it("plugin context exposes commands and metrics accessors", async () => {
    const config = createTestConfig();
    const core = createAgentCore(config);

    let capturedCtx: IPluginContext | undefined;
    await core.loadPlugin({
      manifest: { name: "ctx-test", version: "1.0.0", sandbox: { enabled: false } },
      factory: async (ctx) => {
        capturedCtx = ctx;
        return {};
      },
    });

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.commands).toBeDefined();
    expect(typeof capturedCtx!.commands!.list).toBe("function");
    expect(capturedCtx!.metrics).toBeDefined();
    expect(typeof capturedCtx!.metrics!.getSnapshot).toBe("function");
  });
});
