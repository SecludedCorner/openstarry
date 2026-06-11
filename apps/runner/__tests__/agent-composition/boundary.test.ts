/**
 * Plan54 §4.3 — boundary primitives tests.
 */

import { describe, expect, it } from 'vitest';
import {
  isCapabilityContained,
  isDepthAdmissible,
  walkLineage,
  type LineageNode,
} from '../../src/agent-composition/boundary.js';

describe('Plan54 §4.3 — boundary primitives', () => {
  describe('isDepthAdmissible', () => {
    it('admits parentDepth + 1 ≤ maxDepth', () => {
      expect(isDepthAdmissible(0, 4)).toBe(true);
      expect(isDepthAdmissible(3, 4)).toBe(true);
    });

    it('rejects parentDepth + 1 > maxDepth', () => {
      expect(isDepthAdmissible(4, 4)).toBe(false);
      expect(isDepthAdmissible(5, 4)).toBe(false);
    });

    it('rejects negative or non-integer depth', () => {
      expect(isDepthAdmissible(-1, 4)).toBe(false);
      expect(isDepthAdmissible(2.5, 4)).toBe(false);
    });
  });

  describe('isCapabilityContained (subset semantics default)', () => {
    it('returns true when child capability ∈ parent set', () => {
      expect(isCapabilityContained(['read', 'write'], 'read')).toBe(true);
    });

    it('returns false when child capability ∉ parent set', () => {
      expect(isCapabilityContained(['read'], 'admin')).toBe(false);
    });

    it('empty parent set rejects anything', () => {
      expect(isCapabilityContained([], 'anything')).toBe(false);
    });
  });

  describe('walkLineage', () => {
    const tree: ReadonlyMap<string, LineageNode> = new Map([
      ['root', { agentId: 'root', spawnDepth: 0 }],
      ['child-a', { agentId: 'child-a', spawnDepth: 1 }],
      ['grandchild', { agentId: 'grandchild', spawnDepth: 2 }],
    ]);
    const parentOf: Record<string, string> = {
      'child-a': 'root',
      'grandchild': 'child-a',
    };
    const resolveParent = (id: string): LineageNode | null => {
      const parentId = parentOf[id];
      return parentId ? tree.get(parentId) ?? null : null;
    };

    it('walks a 2-deep chain (depth 2 → 1 → 0)', () => {
      const chain = walkLineage(tree.get('grandchild')!, resolveParent, 4);
      expect(chain.map((n) => n.agentId)).toEqual(['root', 'child-a', 'grandchild']);
    });

    it('returns single-element chain for root (depth 0)', () => {
      const chain = walkLineage(tree.get('root')!, resolveParent, 4);
      expect(chain).toEqual([tree.get('root')!]);
    });

    it('throws on depth exceedance', () => {
      let counter = 0;
      const overflowResolver = (_id: string): LineageNode | null =>
        ({ agentId: `fake-${counter++}`, spawnDepth: 99 });
      const overflowLeaf: LineageNode = { agentId: 'leaf', spawnDepth: 100 };
      expect(() => walkLineage(overflowLeaf, overflowResolver, 4)).toThrow(/MAX_SPAWN_DEPTH/);
    });

    it('throws on cycle detection', () => {
      const cyclicResolver = (id: string): LineageNode | null => {
        if (id === 'a') return { agentId: 'b', spawnDepth: 1 };
        if (id === 'b') return { agentId: 'a', spawnDepth: 1 };
        return null;
      };
      const leaf: LineageNode = { agentId: 'a', spawnDepth: 1 };
      expect(() => walkLineage(leaf, cyclicResolver, 4)).toThrow(/cycle/);
    });

    it('throws when parent unresolved mid-chain', () => {
      const partialResolver = (_id: string): LineageNode | null => null;
      const leaf: LineageNode = { agentId: 'orphan', spawnDepth: 1 };
      expect(() => walkLineage(leaf, partialResolver, 4)).toThrow(/parent unresolved/);
    });
  });
});
