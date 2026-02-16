/**
 * AgentTestFixture — Helper for managing agent lifecycle in E2E tests.
 * Provides a clean agent instance with mocked provider and event capture.
 */

import type {
  IAgentConfig,
  EventBus,
  AgentEvent,
  InputEvent,
} from "@openstarry/sdk";
import { createAgentCore, type AgentCore } from "@openstarry/core";
import { MockProvider } from "./mock-provider.js";

export interface IAgentTestFixture {
  core: AgentCore;
  bus: EventBus;
  events: AgentEvent[];
  mockProvider: MockProvider;

  start(): Promise<void>;
  stop(): Promise<void>;
  pushInput(text: string, sessionId?: string): void;
  waitForEvent(type: string, timeoutMs?: number): Promise<AgentEvent>;
  cleanup(): Promise<void>;
}

export function createAgentFixture(
  config?: Partial<IAgentConfig>,
): IAgentTestFixture {
  const mockProvider = new MockProvider();
  const events: AgentEvent[] = [];

  const defaultConfig: IAgentConfig = {
    identity: {
      id: "test-agent",
      name: "Test Agent",
      version: "0.0.0-test",
    },
    cognition: {
      provider: "mock-provider",
      model: "mock-model",
      temperature: 0.7,
      maxTokens: 1000,
      maxToolRounds: 3,
    },
    capabilities: {
      tools: [],
      allowedPaths: [process.cwd()],
    },
    policy: {
      maxConcurrentTools: 1,
      toolTimeout: 5000,
    },
    memory: {
      slidingWindowSize: 5,
    },
    plugins: [],
    guide: "test-guide",
    ...config,
  };

  const core = createAgentCore(defaultConfig);

  // Inject mock provider (override provider registry)
  core.providerRegistry.register(mockProvider);

  // Capture all events
  const bus = core.bus;
  bus.onAny((event) => events.push(event));

  return {
    core,
    bus,
    events,
    mockProvider,

    async start() {
      await core.start();
    },

    async stop() {
      await core.stop();
    },

    pushInput(text: string, sessionId?: string) {
      const inputEvent: InputEvent = {
        source: "test",
        inputType: "user_input",
        data: text,
        sessionId,
      };
      core.pushInput(inputEvent);
    },

    async waitForEvent(type: string, timeoutMs = 5000): Promise<AgentEvent> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Timeout waiting for event: ${type}`)),
          timeoutMs,
        );

        const unsubscribe = bus.on(type, (event) => {
          clearTimeout(timeout);
          unsubscribe();
          resolve(event);
        });
      });
    },

    async cleanup() {
      await core.stop();
      events.length = 0;
      mockProvider.reset();
    },
  };
}
