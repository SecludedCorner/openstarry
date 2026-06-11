/**
 * PermissionLattice tests — Plan38 C11 (F-5).
 *
 * C11: validateSpawn() — 3 dimensions + combined
 * C11: cascadeTermination() — parent termination propagates to children
 * C11: SpawnDeniedError — correct reason codes + remediation hints
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PermissionLattice } from "../../src/daemon/permission-lattice.js";
import { SpawnDeniedError } from "@openstarry/sdk";
import type { SpawnConstraints, CompositeAgentPermissionLattice } from "@openstarry/sdk";
import type { AgentRegistryEntry } from "../../src/daemon/types.js";

function makeLattice(overrides?: Partial<CompositeAgentPermissionLattice>): CompositeAgentPermissionLattice {
  return {
    allowedPaths: ['/agents/parent'],
    maxTokenBudget: 10000,
    remainingBudget: 5000,
    cumulativeDeltaCeiling: 0.5,
    remainingCeiling: 0.5,
    canSendTo: ['*'],
    canReceiveFrom: ['*'],
    exposedTools: ['tool-a'],
    ...overrides,
  };
}

function makeConstraints(overrides?: Partial<SpawnConstraints>): SpawnConstraints {
  return {
    allowedPaths: ['/agents/parent/child'],
    maxTokenBudget: 1000,
    maxConfidenceCeiling: 0.3,
    ...overrides,
  };
}

function makeRegistryEntry(agentId: string, overrides?: Partial<AgentRegistryEntry>): AgentRegistryEntry {
  return {
    agentId,
    pid: Math.floor(Math.random() * 10000),
    status: 'running',
    configPath: `/agents/${agentId}.json`,
    socketPath: `/tmp/${agentId}.sock`,
    logFile: `/tmp/${agentId}.log`,
    uptime: 0,
    childAgentIds: [],
    ...overrides,
  };
}

describe("PermissionLattice (Plan38 C11 — F-5)", () => {
  let registry: Map<string, AgentRegistryEntry>;
  let onTerminate: ReturnType<typeof vi.fn>;
  let lattice: PermissionLattice;

  beforeEach(() => {
    registry = new Map();
    onTerminate = vi.fn().mockResolvedValue(undefined);
    lattice = new PermissionLattice(registry, onTerminate);
  });

  describe("validateSpawn — path subset dimension", () => {
    it("passes when child path is within parent allowedPaths", () => {
      expect(() =>
        lattice.validateSpawn('parent', makeLattice(), makeConstraints({
          allowedPaths: ['/agents/parent/sub'],
        }))
      ).not.toThrow();
    });

    it("throws PATH_SUBSET_VIOLATION when child path is outside parent scope", () => {
      expect(() =>
        lattice.validateSpawn('parent', makeLattice({
          allowedPaths: ['/agents/parent'],
        }), makeConstraints({
          allowedPaths: ['/agents/other'],
        }))
      ).toThrow(SpawnDeniedError);
    });

    it("PATH_SUBSET_VIOLATION error has correct reason code", () => {
      let caughtError: SpawnDeniedError | null = null;
      try {
        lattice.validateSpawn('parent', makeLattice({
          allowedPaths: ['/agents/parent'],
        }), makeConstraints({
          allowedPaths: ['/outside/path'],
        }));
      } catch (e) {
        caughtError = e as SpawnDeniedError;
      }
      expect(caughtError).not.toBeNull();
      expect(caughtError!.reason).toBe('PATH_SUBSET_VIOLATION');
      expect(caughtError!.parentId).toBe('parent');
    });

    it("PATH_SUBSET_VIOLATION includes remediation hint (DARWIN)", () => {
      let caughtError: SpawnDeniedError | null = null;
      try {
        lattice.validateSpawn('parent', makeLattice({
          allowedPaths: ['/agents/parent'],
        }), makeConstraints({
          allowedPaths: ['/outside/path'],
        }));
      } catch (e) {
        caughtError = e as SpawnDeniedError;
      }
      expect(caughtError!.detail).toMatch(/Remediation/);
    });

    it("passes when child has empty allowedPaths", () => {
      expect(() =>
        lattice.validateSpawn('parent', makeLattice(), makeConstraints({
          allowedPaths: [],
        }))
      ).not.toThrow();
    });
  });

  describe("validateSpawn — token budget dimension", () => {
    it("passes when child budget <= parent remaining budget", () => {
      expect(() =>
        lattice.validateSpawn('parent', makeLattice({ remainingBudget: 5000 }), makeConstraints({
          maxTokenBudget: 5000,
        }))
      ).not.toThrow();
    });

    it("throws BUDGET_EXCEEDED when child budget > parent remaining", () => {
      expect(() =>
        lattice.validateSpawn('parent', makeLattice({ remainingBudget: 100 }), makeConstraints({
          maxTokenBudget: 500,
        }))
      ).toThrow(SpawnDeniedError);
    });

    it("BUDGET_EXCEEDED error has correct reason code", () => {
      let caughtError: SpawnDeniedError | null = null;
      try {
        lattice.validateSpawn('parent', makeLattice({ remainingBudget: 100 }), makeConstraints({
          maxTokenBudget: 9999,
        }));
      } catch (e) {
        caughtError = e as SpawnDeniedError;
      }
      expect(caughtError!.reason).toBe('BUDGET_EXCEEDED');
    });

    it("BUDGET_EXCEEDED includes remediation hint (DARWIN)", () => {
      let caughtError: SpawnDeniedError | null = null;
      try {
        lattice.validateSpawn('parent', makeLattice({ remainingBudget: 100 }), makeConstraints({
          maxTokenBudget: 9999,
        }));
      } catch (e) {
        caughtError = e as SpawnDeniedError;
      }
      expect(caughtError!.detail).toMatch(/Remediation/);
    });
  });

  describe("validateSpawn — confidence ceiling dimension", () => {
    it("passes when child ceiling <= parent remaining ceiling", () => {
      expect(() =>
        lattice.validateSpawn('parent', makeLattice({ remainingCeiling: 0.5 }), makeConstraints({
          maxConfidenceCeiling: 0.5,
        }))
      ).not.toThrow();
    });

    it("throws CEILING_EXCEEDED when child ceiling > parent remaining ceiling", () => {
      expect(() =>
        lattice.validateSpawn('parent', makeLattice({ remainingCeiling: 0.3 }), makeConstraints({
          maxConfidenceCeiling: 0.9,
        }))
      ).toThrow(SpawnDeniedError);
    });

    it("CEILING_EXCEEDED error has correct reason code", () => {
      let caughtError: SpawnDeniedError | null = null;
      try {
        lattice.validateSpawn('parent', makeLattice({ remainingCeiling: 0.3 }), makeConstraints({
          maxConfidenceCeiling: 0.9,
        }));
      } catch (e) {
        caughtError = e as SpawnDeniedError;
      }
      expect(caughtError!.reason).toBe('CEILING_EXCEEDED');
    });

    it("CEILING_EXCEEDED includes remediation hint (DARWIN)", () => {
      let caughtError: SpawnDeniedError | null = null;
      try {
        lattice.validateSpawn('parent', makeLattice({ remainingCeiling: 0.1 }), makeConstraints({
          maxConfidenceCeiling: 0.9,
        }));
      } catch (e) {
        caughtError = e as SpawnDeniedError;
      }
      expect(caughtError!.detail).toMatch(/Remediation/);
    });
  });

  describe("validateSpawn — combined constraints", () => {
    it("passes with all 3 dimensions within bounds", () => {
      expect(() =>
        lattice.validateSpawn('parent', makeLattice({
          allowedPaths: ['/agents/parent'],
          remainingBudget: 5000,
          remainingCeiling: 0.5,
        }), makeConstraints({
          allowedPaths: ['/agents/parent/child'],
          maxTokenBudget: 1000,
          maxConfidenceCeiling: 0.3,
        }))
      ).not.toThrow();
    });

    it("fails on first violation encountered (path check first)", () => {
      let caughtError: SpawnDeniedError | null = null;
      try {
        lattice.validateSpawn('parent', makeLattice({
          allowedPaths: ['/agents/parent'],
          remainingBudget: 100,
          remainingCeiling: 0.1,
        }), makeConstraints({
          allowedPaths: ['/outside/path'],
          maxTokenBudget: 9999,
          maxConfidenceCeiling: 0.9,
        }));
      } catch (e) {
        caughtError = e as SpawnDeniedError;
      }
      expect(caughtError!.reason).toBe('PATH_SUBSET_VIOLATION');
    });
  });

  describe("cascadeTermination", () => {
    it("returns empty array when parent has no children", async () => {
      registry.set('parent', makeRegistryEntry('parent', { childAgentIds: [] }));
      const terminated = await lattice.cascadeTermination('parent');
      expect(terminated).toEqual([]);
    });

    it("returns empty array when parent not in registry", async () => {
      const terminated = await lattice.cascadeTermination('nonexistent');
      expect(terminated).toEqual([]);
    });

    it("terminates all direct children", async () => {
      registry.set('parent', makeRegistryEntry('parent', { childAgentIds: ['child-a', 'child-b'] }));
      registry.set('child-a', makeRegistryEntry('child-a'));
      registry.set('child-b', makeRegistryEntry('child-b'));

      const terminated = await lattice.cascadeTermination('parent');

      expect(terminated).toContain('child-a');
      expect(terminated).toContain('child-b');
      expect(onTerminate).toHaveBeenCalledWith('child-a');
      expect(onTerminate).toHaveBeenCalledWith('child-b');
    });

    it("cascades recursively to grandchildren", async () => {
      registry.set('parent', makeRegistryEntry('parent', { childAgentIds: ['child'] }));
      registry.set('child', makeRegistryEntry('child', { childAgentIds: ['grandchild'] }));
      registry.set('grandchild', makeRegistryEntry('grandchild'));

      const terminated = await lattice.cascadeTermination('parent');

      expect(terminated).toContain('child');
      expect(terminated).toContain('grandchild');
      expect(onTerminate).toHaveBeenCalledTimes(2);
    });

    it("skips already-terminated children", async () => {
      registry.set('parent', makeRegistryEntry('parent', { childAgentIds: ['child'] }));
      registry.set('child', makeRegistryEntry('child', { status: 'terminated' }));

      const terminated = await lattice.cascadeTermination('parent');

      expect(terminated).not.toContain('child');
      expect(onTerminate).not.toHaveBeenCalled();
    });

    it("continues cascade even if one child termination fails", async () => {
      onTerminate
        .mockRejectedValueOnce(new Error('kill failed'))
        .mockResolvedValue(undefined);

      registry.set('parent', makeRegistryEntry('parent', { childAgentIds: ['child-a', 'child-b'] }));
      registry.set('child-a', makeRegistryEntry('child-a'));
      registry.set('child-b', makeRegistryEntry('child-b'));

      const terminated = await lattice.cascadeTermination('parent');

      // Both attempted — child-a fails but child-b still terminates
      expect(terminated).toContain('child-a');
      expect(terminated).toContain('child-b');
    });
  });
});
