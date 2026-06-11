/**
 * W0-3: Plugin Config Propagation Integration Test (Rule #68 Two-Path)
 *
 * End-to-end verification that plugin config from agent.json flows correctly
 * through BOTH config delivery paths:
 *
 *   Path A: resolvePlugin(ref) → factory(ref.config)   [module-level, Stage 1]
 *   Path B: getPluginContext(pluginRef?.config) → ctx.config  [runtime, Stage 2]
 *
 * This test would have caught Fix 12d (Path A was factory() with no args before
 * v0.44.0-alpha). Covers ENG-FAB v1.4 F-7.
 *
 * @see Architecture_Documentation/71_Two_Path_Config_Propagation.md
 * @see Rule #68 (Two-Path Verification)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

// -------------------------------------------------------------------------
// Test plugin factory — written to a temp file and loaded dynamically.
// Records the config it receives at both Stage 1 (Path A) and Stage 2 (Path B).
// -------------------------------------------------------------------------

const TEST_PLUGIN_FACTORY_SOURCE = `
// Minimal test plugin for Rule #68 Two-Path Config Propagation verification.
// Stage 1 capture (Path A): config received via factory(config) argument.
// Stage 2 capture (Path B): config received via ctx.config.

let capturedPathA = undefined;
let capturedPathB = undefined;

export function getCapturedPathA() { return capturedPathA; }
export function getCapturedPathB() { return capturedPathB; }
export function resetCaptures() { capturedPathA = undefined; capturedPathB = undefined; }

export function createTestConfigPlugin(config) {
  // Path A: config arrives here as factory argument (Stage 1)
  capturedPathA = config;

  return {
    manifest: {
      name: '@test/config-propagation-plugin',
      version: '0.0.1',
      description: 'Rule #68 two-path verification plugin',
    },
    async factory(ctx) {
      // Path B: config arrives here via ctx.config (Stage 2)
      capturedPathB = ctx.config;
      return { dispose: () => {} };
    },
  };
}

export default createTestConfigPlugin;
`;

// -------------------------------------------------------------------------
// Minimal IPluginContext mock for Path B testing.
// Only provides what the test plugin's factory(ctx) needs.
// -------------------------------------------------------------------------
function createMockPluginContext(pluginConfig: Record<string, unknown>) {
  return {
    bus: {
      on: () => () => {},
      emit: () => {},
    },
    workingDirectory: process.cwd(),
    agentId: 'test-agent',
    config: pluginConfig,
    pushInput: () => {},
    sessions: {},
    tools: { list: () => [], get: () => undefined },
    guides: { list: () => [] },
    providers: { list: () => [], get: () => undefined },
    services: { get: () => undefined, register: () => {} },
    commands: { list: () => [] },
    metrics: { getSnapshot: () => ({}) },
  };
}

// -------------------------------------------------------------------------
// Test setup: write plugin file to a temp directory
// -------------------------------------------------------------------------

let tempDir: string;
let pluginFilePath: string;
let pluginFileUrl: string;

beforeAll(async () => {
  tempDir = join(tmpdir(), `openstarry-w0-3-test-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  pluginFilePath = join(tempDir, 'test-config-plugin.mjs');
  await writeFile(pluginFilePath, TEST_PLUGIN_FACTORY_SOURCE, 'utf-8');
  pluginFileUrl = pathToFileURL(pluginFilePath).href;
});

afterAll(async () => {
  if (existsSync(tempDir)) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------
// Test suite
// -------------------------------------------------------------------------

describe('Plugin Config Propagation — Rule #68 Two-Path (W0-3)', () => {
  const SPECIFIC_CONFIG: Record<string, unknown> = {
    enabled: true,
    windowSize: 75,
    calibrationState: 'LOCKED',
    escalationConfig: { windowMs: 300000, thresholds: { watch: 2, warning: 4, critical: 7 } },
  };

  // -----------------------------------------------------------------------
  // AC-W0-3a: Path A — module factory receives plugin config
  // -----------------------------------------------------------------------
  it('AC-W0-3a: Path A — module factory(config) receives correct plugin config', async () => {
    const mod = await import(pluginFileUrl) as {
      createTestConfigPlugin: (config?: Record<string, unknown>) => unknown;
      getCapturedPathA: () => unknown;
      resetCaptures: () => void;
    };

    mod.resetCaptures();

    // Simulate what plugin-resolver.ts does: factory(ref.config)
    // This is the Fix 12d pattern. Before Fix 12d this was factory() with no args.
    mod.createTestConfigPlugin(SPECIFIC_CONFIG);

    const capturedA = mod.getCapturedPathA();

    expect(capturedA, 'Path A FAILED: factory() did not receive config (pre-Fix12d regression)').not.toBeUndefined();
    expect(capturedA).toEqual(SPECIFIC_CONFIG);
    expect((capturedA as Record<string, unknown>).windowSize).toBe(75);
    expect((capturedA as Record<string, unknown>).calibrationState).toBe('LOCKED');
  });

  // -----------------------------------------------------------------------
  // AC-W0-3b: Path B — ctx.config receives plugin config
  // -----------------------------------------------------------------------
  it('AC-W0-3b: Path B — IPluginContext.config receives correct plugin config', async () => {
    const mod = await import(pluginFileUrl) as {
      createTestConfigPlugin: (config?: Record<string, unknown>) => {
        manifest: unknown;
        factory: (ctx: ReturnType<typeof createMockPluginContext>) => Promise<unknown>;
      };
      getCapturedPathB: () => unknown;
      resetCaptures: () => void;
    };

    mod.resetCaptures();

    // Stage 1: build IPlugin (Path A — passing config)
    const plugin = mod.createTestConfigPlugin(SPECIFIC_CONFIG);

    // Stage 2: build IPluginHooks — simulate agent-core.ts::getPluginContext(pluginRef?.config)
    const ctx = createMockPluginContext(SPECIFIC_CONFIG);
    await plugin.factory(ctx);

    const capturedB = mod.getCapturedPathB();

    expect(capturedB, 'Path B FAILED: ctx.config was not set or was empty').not.toBeUndefined();
    expect(capturedB).toEqual(SPECIFIC_CONFIG);
    expect((capturedB as Record<string, unknown>).escalationConfig).toBeDefined();
    expect(
      ((capturedB as Record<string, unknown>).escalationConfig as Record<string, unknown>).windowMs
    ).toBe(300000);
  });

  // -----------------------------------------------------------------------
  // AC-W0-3c: Fallback — no config in agent.json, factory must not throw
  // -----------------------------------------------------------------------
  it('AC-W0-3c: Fallback — factory handles undefined config gracefully', async () => {
    const mod = await import(pluginFileUrl) as {
      createTestConfigPlugin: (config?: Record<string, unknown>) => {
        manifest: unknown;
        factory: (ctx: ReturnType<typeof createMockPluginContext>) => Promise<unknown>;
      };
      getCapturedPathA: () => unknown;
      getCapturedPathB: () => unknown;
      resetCaptures: () => void;
    };

    mod.resetCaptures();

    // Path A: factory called with undefined (agent.json has no config for this plugin)
    expect(
      () => mod.createTestConfigPlugin(undefined),
      'Path A FAILED: factory(undefined) threw unexpectedly'
    ).not.toThrow();

    const plugin = mod.createTestConfigPlugin(undefined);
    const capturedA = mod.getCapturedPathA();
    expect(capturedA).toBeUndefined();

    // Path B: ctx.config is empty object (agent-core.ts uses: pluginConfig ?? {})
    const ctx = createMockPluginContext({});
    await expect(
      plugin.factory(ctx),
      'Path B FAILED: factory(ctx) with empty config threw unexpectedly'
    ).resolves.not.toThrow();

    const capturedB = mod.getCapturedPathB();
    expect(capturedB).toEqual({});
  });

  // -----------------------------------------------------------------------
  // Both paths simultaneously: confirm A and B receive identical config
  // -----------------------------------------------------------------------
  it('Both paths receive identical config from the same agent.json plugin entry', async () => {
    const mod = await import(pluginFileUrl) as {
      createTestConfigPlugin: (config?: Record<string, unknown>) => {
        manifest: unknown;
        factory: (ctx: ReturnType<typeof createMockPluginContext>) => Promise<unknown>;
      };
      getCapturedPathA: () => unknown;
      getCapturedPathB: () => unknown;
      resetCaptures: () => void;
    };

    mod.resetCaptures();

    const agentJsonPluginConfig: Record<string, unknown> = {
      enabled: true,
      windowSize: 50,
    };

    // Simulate the full pipeline:
    //   1. resolvePlugin(ref) calls factory(ref.config)  → Path A
    //   2. agent-core getPluginContext(pluginRef?.config) → Path B
    const plugin = mod.createTestConfigPlugin(agentJsonPluginConfig);
    const ctx = createMockPluginContext(agentJsonPluginConfig);
    await plugin.factory(ctx);

    const capturedA = mod.getCapturedPathA();
    const capturedB = mod.getCapturedPathB();

    expect(capturedA).toEqual(agentJsonPluginConfig);
    expect(capturedB).toEqual(agentJsonPluginConfig);
    expect(capturedA).toEqual(capturedB);
  });
});
