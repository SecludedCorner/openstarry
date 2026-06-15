/**
 * Tenet #2 / #9 negative-path proof: context manager is a REQUIRED plugin class.
 *
 * The ledger (TENETS_FULFILLMENT.md #2 and #9) claims "core 缺之即 throw".
 * The throw lives in agent-core.ts start() (Plan32 Wave 6: getContextManager()
 * === null → throw). Every other core/loop test injects a mock context manager,
 * so until this file the throw path was source-true but test-unproven — a gap
 * flagged by the 2026-06-12 ledger-vs-code verification. This test exercises the
 * negative path directly: start() with zero context-manager plugins must reject.
 */

import { describe, it, expect, vi } from "vitest";
import type {
  IProvider,
  IAgentConfig,
  ProviderStreamEvent,
  IPluginContext,
  PluginHooks,
  IContextManager,
  Message,
  IPlugin,
} from "@openstarry/sdk";
import { createAgentCore } from "../agent-core.js";

const createMockProvider = (id: string): IProvider => ({
  skandha: "samjna" as const,
  id,
  name: `Provider ${id}`,
  models: [{ id: "m", name: "m" }],
  chat: vi.fn(async function* (): AsyncGenerator<ProviderStreamEvent> {
    yield { type: "finish", stopReason: "end_turn", usage: { totalTokens: 1 } } as unknown as ProviderStreamEvent;
  }),
});

function createMockContextManagerPlugin(): IPlugin {
  return {
    manifest: { name: "@test/mock-context-manager", version: "0.0.0", skandha: "samjna" },
    async factory(_ctx: IPluginContext): Promise<PluginHooks> {
      const contextManager: IContextManager = {
        assembleContext(messages: Message[], _maxTurns: number): Message[] {
          return messages;
        },
      };
      return { contextManager };
    },
  };
}

function createTestConfig(): IAgentConfig {
  return {
    identity: { id: "test-agent", name: "Test Agent" },
    plugins: [],
    cognition: { provider: "p1", model: "m" },
    capabilities: {},
  };
}

describe("Context manager is a required plugin (Tenet #2/#9 negative path)", () => {
  it("start() rejects when no context-manager plugin is installed", async () => {
    const core = createAgentCore(createTestConfig());
    core.providerRegistry.register(createMockProvider("p1"));
    // Deliberately load NO context-manager plugin.

    await expect(core.start()).rejects.toThrow(/No context manager plugin installed/);

    await core.stop().catch(() => {
      /* start() failed before full init; stop() may be a no-op or throw — ignore */
    });
  });

  it("start() succeeds once a context-manager plugin is present (positive control)", async () => {
    const core = createAgentCore(createTestConfig());
    core.providerRegistry.register(createMockProvider("p1"));
    await core.loadPlugin(createMockContextManagerPlugin());

    await expect(core.start()).resolves.not.toThrow();

    await core.stop();
  });
});
