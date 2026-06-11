import { describe, it, expect, vi } from "vitest";
import type { IPlugin, IPluginContext, PluginHooks, EventBus, AgentEvent } from "@openstarry/sdk";
import { AgentEventType } from "@openstarry/sdk";
import { createPluginLoader } from "../plugin-loader.js";
import type { SignatureVerifier } from "../../sandbox/signature-verification.js";

function createMockDeps(overrides?: {
  bus?: EventBus;
  signatureVerifier?: SignatureVerifier;
}) {
  return {
    toolRegistry: { register: vi.fn(), get: vi.fn(), list: vi.fn(), remove: vi.fn() },
    providerRegistry: { register: vi.fn(), get: vi.fn(), list: vi.fn(), remove: vi.fn() },
    listenerRegistry: { register: vi.fn(), get: vi.fn(), list: vi.fn(), remove: vi.fn() },
    uiRegistry: { register: vi.fn(), get: vi.fn(), list: vi.fn(), remove: vi.fn() },
    guideRegistry: { register: vi.fn(), get: vi.fn(), list: vi.fn(), remove: vi.fn() },
    commandRegistry: { register: vi.fn(), get: vi.fn(), list: vi.fn(), execute: vi.fn() },
    ...overrides,
  };
}

function createMockPlugin(overrides?: Partial<IPlugin["manifest"]>): IPlugin {
  return {
    manifest: {
      name: "test-plugin",
      version: "1.0.0",
      ...overrides,
    },
    factory: vi.fn(async () => ({} as PluginHooks)),
  };
}

function createMockCtx(): IPluginContext {
  return {
    agentId: "test",
    bus: { on: vi.fn(), once: vi.fn(), onAny: vi.fn(), emit: vi.fn() },
    pushInput: vi.fn(),
    sessions: { create: vi.fn(), get: vi.fn(), list: vi.fn(), destroy: vi.fn() },
    config: {},
  } as unknown as IPluginContext;
}

describe("PluginLoader signature verification (A1)", () => {
  it("verifies signature for non-sandbox plugin with integrity field", async () => {
    const verifier: SignatureVerifier = {
      verifyPlugin: vi.fn(async () => {}),
      computeHash: vi.fn(),
      verifyPkiSignature: vi.fn(),
    };

    const events: AgentEvent[] = [];
    const bus: EventBus = {
      on: vi.fn(),
      once: vi.fn(),
      onAny: vi.fn(),
      emit: vi.fn((e: AgentEvent) => events.push(e)),
    };

    const loader = createPluginLoader(createMockDeps({ bus, signatureVerifier: verifier }));

    const plugin = createMockPlugin({
      integrity: "a".repeat(128), // SHA-512 legacy format
    });
    // Set ref path (internal field used for file path resolution)
    (plugin.manifest as any).ref = { path: "/fake/plugin.js" };

    await loader.load(plugin, createMockCtx());

    expect(verifier.verifyPlugin).toHaveBeenCalledWith(plugin, "/fake/plugin.js");
    expect(events.some(e => e.type === AgentEventType.SANDBOX_SIGNATURE_VERIFIED)).toBe(true);
  });

  it("rejects plugin when signature verification fails", async () => {
    const verifier: SignatureVerifier = {
      verifyPlugin: vi.fn(async () => {
        throw new Error("Hash mismatch");
      }),
      computeHash: vi.fn(),
      verifyPkiSignature: vi.fn(),
    };

    const events: AgentEvent[] = [];
    const bus: EventBus = {
      on: vi.fn(),
      once: vi.fn(),
      onAny: vi.fn(),
      emit: vi.fn((e: AgentEvent) => events.push(e)),
    };

    const loader = createPluginLoader(createMockDeps({ bus, signatureVerifier: verifier }));

    const plugin = createMockPlugin({
      integrity: "b".repeat(128),
    });
    (plugin.manifest as any).ref = { path: "/fake/plugin.js" };

    await expect(loader.load(plugin, createMockCtx())).rejects.toThrow("Signature verification failed");
    expect(events.some(e => e.type === AgentEventType.SANDBOX_SIGNATURE_FAILED)).toBe(true);
    // factory should NOT have been called
    expect(plugin.factory).not.toHaveBeenCalled();
  });

  it("skips verification when no integrity field", async () => {
    const verifier: SignatureVerifier = {
      verifyPlugin: vi.fn(),
      computeHash: vi.fn(),
      verifyPkiSignature: vi.fn(),
    };

    const loader = createPluginLoader(createMockDeps({ signatureVerifier: verifier }));
    const plugin = createMockPlugin(); // no integrity
    await loader.load(plugin, createMockCtx());

    expect(verifier.verifyPlugin).not.toHaveBeenCalled();
    expect(plugin.factory).toHaveBeenCalled();
  });

  it("skips verification when no file path (ref)", async () => {
    const verifier: SignatureVerifier = {
      verifyPlugin: vi.fn(),
      computeHash: vi.fn(),
      verifyPkiSignature: vi.fn(),
    };

    const loader = createPluginLoader(createMockDeps({ signatureVerifier: verifier }));
    const plugin = createMockPlugin({
      integrity: "c".repeat(128),
    });
    // No ref field — programmatically loaded plugin

    await loader.load(plugin, createMockCtx());

    expect(verifier.verifyPlugin).not.toHaveBeenCalled();
    // Plugin should still load (warning only)
    expect(plugin.factory).toHaveBeenCalled();
  });

  it("does not double-verify sandbox plugins", async () => {
    const verifier: SignatureVerifier = {
      verifyPlugin: vi.fn(),
      computeHash: vi.fn(),
      verifyPkiSignature: vi.fn(),
    };

    const loader = createPluginLoader(createMockDeps({ signatureVerifier: verifier }));

    const plugin = createMockPlugin({
      integrity: "d".repeat(128),
      sandbox: { enabled: true }, // sandbox enabled
    });
    (plugin.manifest as any).ref = { path: "/fake/plugin.js" };

    // Without sandboxManager, it falls back to direct load, but the verification
    // check skips because sandboxEnabled is true (sandbox path handles its own)
    await loader.load(plugin, createMockCtx());

    expect(verifier.verifyPlugin).not.toHaveBeenCalled();
  });
});
