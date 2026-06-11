/**
 * Tests for ManoAggregator Plan31 features:
 * - AuditContext assembly
 * - historicalConfidence buffer (WIENER C-1)
 * - Destructive delta ≤ 0 safety constraint (D1-R1)
 * - extras collection via audit:context_contribute
 * - WIENER C-3: audit: prefix rejected in extras
 *
 * @see mano/mano-aggregator.ts
 * @see Plan31 engineering_recommendations.md
 */
import { describe, it, expect, vi } from "vitest";
import { createManoAggregator } from "../mano-aggregator.js";
import type {
  EventBus,
  IGearArbiter,
  GearContext,
  IConfidenceAuditor,
  ManoAggregatorConfig,
  AuditContext,
  RouteResult,
  AgentEvent,
} from "@openstarry/sdk";
import { DEFAULT_MANO_AGGREGATOR_CONFIG } from "@openstarry/sdk";

function makeBus(): EventBus & { handlers: Map<string, Array<(event: AgentEvent) => void>> } {
  const handlers = new Map<string, Array<(event: AgentEvent) => void>>();
  return {
    handlers,
    emit: vi.fn((event: AgentEvent) => {
      const list = handlers.get(event.type);
      if (list) list.forEach(h => h(event));
    }),
    on: vi.fn((type: string, handler: (event: AgentEvent) => void) => {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type)!.push(handler);
      return () => {
        const arr = handlers.get(type);
        if (arr) {
          const idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        }
      };
    }),
    once: vi.fn(),
    onAny: vi.fn(),
  } as unknown as EventBus & { handlers: Map<string, Array<(event: AgentEvent) => void>> };
}

function makeContext(): GearContext {
  return {
    input: "test",
    proposedToolCalls: [{ name: "read_file", arguments: {} }],
    actionHistory: [],
    agentConfig: { id: "test-agent" },
  };
}

function makeArbiter(id: string, gear: number, confidence: number, riskCategory?: 'destructive' | 'state_modifying' | 'read_only' | 'informational'): IGearArbiter {
  return {
    id,
    priority: 10,
    evaluate: () => ({
      action: gear,
      confidence,
      riskCategory,
    }),
  };
}

function makeCapturingAuditor(): IConfidenceAuditor & { capturedContext: AuditContext | RouteResult | null } {
  const auditor = {
    skandha: 'vijnana' as const,
    id: 'capturing-auditor',
    capturedContext: null as AuditContext | RouteResult | null,
    audit: vi.fn((ctx: AuditContext | RouteResult) => {
      auditor.capturedContext = ctx;
      return { delta: 0, reasoning: 'captured' };
    }),
  };
  return auditor;
}

describe("ManoAggregator — Plan31 AuditContext", () => {
  it("passes AuditContext (not RouteResult) to auditor", async () => {
    const bus = makeBus();
    const auditor = makeCapturingAuditor();
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, auditor);
    const arbiter = makeArbiter("a1", 1, 0.80, 'informational');

    await agg.route(makeContext(), [arbiter]);

    expect(auditor.capturedContext).not.toBeNull();
    const ctx = auditor.capturedContext as AuditContext;
    expect(ctx.version).toBe(1);
    expect(ctx.gearEvaluation).toBeDefined();
    expect(ctx.gearEvaluation.confidence).toBe(0.80);
    expect(ctx.routeResult).toBeDefined();
    expect(ctx.routeResult.gear).toBe(1);
    expect(ctx.extras).toBeInstanceOf(Map);
  });

  it("includes sparshEvent when provided", async () => {
    const bus = makeBus();
    const auditor = makeCapturingAuditor();
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, auditor);
    const arbiter = makeArbiter("a1", 1, 0.80, 'informational');
    const sparsh = { root: 'mano', object: 'test', consciousness: 'vijnana', timestamp: 12345 };

    await agg.route(makeContext(), [arbiter], sparsh);

    const ctx = auditor.capturedContext as AuditContext;
    expect(ctx.sparshEvent.root).toBe('mano');
    expect(ctx.sparshEvent.consciousness).toBe('vijnana');
  });

  it("uses fallback sparshEvent when none provided", async () => {
    const bus = makeBus();
    const auditor = makeCapturingAuditor();
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, auditor);
    const arbiter = makeArbiter("a1", 1, 0.80, 'informational');

    await agg.route(makeContext(), [arbiter]);

    const ctx = auditor.capturedContext as AuditContext;
    expect(ctx.sparshEvent.root).toBe('unknown');
  });

  it("riskCategory propagated from evaluation", async () => {
    const bus = makeBus();
    const auditor = makeCapturingAuditor();
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, auditor);
    const arbiter = makeArbiter("a1", 1, 0.80, 'state_modifying');

    await agg.route(makeContext(), [arbiter]);

    const ctx = auditor.capturedContext as AuditContext;
    expect(ctx.riskCategory).toBe('state_modifying');
  });

  it("riskCategory is undefined when not declared by arbiter", async () => {
    const bus = makeBus();
    const auditor = makeCapturingAuditor();
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, auditor);
    // Arbiter without riskCategory
    const arbiter: IGearArbiter = {
      id: 'no-risk',
      priority: 10,
      evaluate: () => ({ action: 1, confidence: 0.80 }),
    };

    await agg.route(makeContext(), [arbiter]);

    const ctx = auditor.capturedContext as AuditContext;
    expect(ctx.riskCategory).toBeUndefined();
  });
});

describe("ManoAggregator — Plan31 historicalConfidence (WIENER C-1)", () => {
  it("historicalConfidence accumulates raw arbiter confidence values", async () => {
    const bus = makeBus();
    const auditor = makeCapturingAuditor();
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, auditor);
    const arbiter = makeArbiter("a1", 1, 0.80, 'informational');

    await agg.route(makeContext(), [arbiter]);
    const ctx1 = auditor.capturedContext as AuditContext;
    expect(ctx1.historicalConfidence).toEqual([0.80]);

    const arbiter2 = makeArbiter("a2", 1, 0.75, 'informational');
    await agg.route(makeContext(), [arbiter2]);
    const ctx2 = auditor.capturedContext as AuditContext;
    expect(ctx2.historicalConfidence).toEqual([0.80, 0.75]);
  });

  it("historicalConfidence contains raw values, not audit-adjusted values", async () => {
    const bus = makeBus();
    // Auditor that adjusts by +0.05
    const auditor: IConfidenceAuditor & { capturedContext: AuditContext | RouteResult | null } = {
      skandha: 'vijnana',
      id: 'adjusting-auditor',
      capturedContext: null,
      audit: vi.fn(function(this: typeof auditor, ctx: AuditContext | RouteResult) {
        auditor.capturedContext = ctx;
        return { delta: 0.05, reasoning: 'boost' };
      }),
    };
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, auditor);

    await agg.route(makeContext(), [makeArbiter("a1", 1, 0.80, 'informational')]);
    // First route: historical = [0.80] (raw), output confidence = 0.85 (audited)
    await agg.route(makeContext(), [makeArbiter("a2", 1, 0.70, 'informational')]);
    // Second route: historical = [0.80, 0.70] (raw, not 0.85)
    const ctx = auditor.capturedContext as AuditContext;
    expect(ctx.historicalConfidence).toEqual([0.80, 0.70]);
  });

  it("historicalConfidence respects maxHistory window", async () => {
    const bus = makeBus();
    const auditor = makeCapturingAuditor();
    const smallConfig: ManoAggregatorConfig = { ...DEFAULT_MANO_AGGREGATOR_CONFIG, historicalConfidenceSize: 3 };
    const agg = createManoAggregator(bus, smallConfig, undefined, undefined, undefined, auditor);

    for (let i = 1; i <= 5; i++) {
      await agg.route(makeContext(), [makeArbiter(`a${i}`, 1, 0.50 + i * 0.05, 'informational')]);
    }

    const ctx = auditor.capturedContext as AuditContext;
    // Window size = 3, so only last 3 values
    expect(ctx.historicalConfidence).toHaveLength(3);
    expect(ctx.historicalConfidence).toEqual([0.65, 0.70, 0.75]);
  });
});

describe("ManoAggregator — Plan31 destructive delta ≤ 0 (D1-R1)", () => {
  it("positive delta forced to 0 for destructive riskCategory", async () => {
    const bus = makeBus();
    const auditor: IConfidenceAuditor = {
      skandha: 'vijnana',
      id: 'boost-auditor',
      audit: () => ({ delta: 0.05, reasoning: 'try to boost destructive' }),
    };
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, auditor);
    const arbiter = makeArbiter("a1", 1, 0.85, 'destructive');

    const result = await agg.route(makeContext(), [arbiter]);
    // Delta should be 0 (not +0.05) because destructive
    expect(result.confidence).toBeCloseTo(0.85, 2);
  });

  it("negative delta allowed for destructive riskCategory", async () => {
    const bus = makeBus();
    const auditor: IConfidenceAuditor = {
      skandha: 'vijnana',
      id: 'reduce-auditor',
      audit: () => ({ delta: -0.03, reasoning: 'reduce destructive confidence' }),
    };
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, auditor);
    const arbiter = makeArbiter("a1", 1, 0.85, 'destructive');

    const result = await agg.route(makeContext(), [arbiter]);
    expect(result.confidence).toBeCloseTo(0.82, 2);
  });

  it("zero delta allowed for destructive riskCategory", async () => {
    const bus = makeBus();
    const auditor: IConfidenceAuditor = {
      skandha: 'vijnana',
      id: 'zero-auditor',
      audit: () => ({ delta: 0, reasoning: 'no change' }),
    };
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, auditor);
    const arbiter = makeArbiter("a1", 1, 0.85, 'destructive');

    const result = await agg.route(makeContext(), [arbiter]);
    expect(result.confidence).toBeCloseTo(0.85, 2);
  });

  it("positive delta allowed for non-destructive riskCategory", async () => {
    const bus = makeBus();
    const auditor: IConfidenceAuditor = {
      skandha: 'vijnana',
      id: 'boost-auditor',
      audit: () => ({ delta: 0.04, reasoning: 'boost' }),
    };
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, auditor);
    const arbiter = makeArbiter("a1", 1, 0.80, 'informational');

    const result = await agg.route(makeContext(), [arbiter]);
    expect(result.confidence).toBeCloseTo(0.84, 2);
  });
});

describe("ManoAggregator — Plan31 extras collection", () => {
  it("extras from audit:context_contribute events are included", async () => {
    const bus = makeBus();
    const auditor = makeCapturingAuditor();
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, auditor);
    const arbiter = makeArbiter("a1", 1, 0.80, 'informational');

    // Simulate plugin contributing extras before route evaluates auditor
    // We need a specially crafted arbiter that emits extras during evaluation
    const extrasArbiter: IGearArbiter = {
      id: 'extras-arbiter',
      priority: 10,
      evaluate: () => {
        bus.emit({
          type: 'audit:context_contribute',
          timestamp: Date.now(),
          payload: { key: 'plugin.mykey', value: 42 },
        });
        return { action: 1, confidence: 0.80, riskCategory: 'informational' as const };
      },
    };

    await agg.route(makeContext(), [extrasArbiter]);
    const ctx = auditor.capturedContext as AuditContext;
    expect(ctx.extras.get('plugin.mykey')).toBe(42);
  });

  it("WIENER C-3: extras keys with 'audit:' prefix are rejected", async () => {
    const bus = makeBus();
    const auditor = makeCapturingAuditor();
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, auditor);

    const maliciousArbiter: IGearArbiter = {
      id: 'malicious-arbiter',
      priority: 10,
      evaluate: () => {
        bus.emit({
          type: 'audit:context_contribute',
          timestamp: Date.now(),
          payload: { key: 'audit:spoofed', value: 'evil' },
        });
        bus.emit({
          type: 'audit:context_contribute',
          timestamp: Date.now(),
          payload: { key: 'Audit:CaseSensitive', value: 'also evil' },
        });
        bus.emit({
          type: 'audit:context_contribute',
          timestamp: Date.now(),
          payload: { key: 'safe.key', value: 'ok' },
        });
        return { action: 1, confidence: 0.80, riskCategory: 'informational' as const };
      },
    };

    await agg.route(makeContext(), [maliciousArbiter]);
    const ctx = auditor.capturedContext as AuditContext;
    expect(ctx.extras.has('audit:spoofed')).toBe(false);
    expect(ctx.extras.has('Audit:CaseSensitive')).toBe(false);
    expect(ctx.extras.get('safe.key')).toBe('ok');
  });

  it("extras are cleared between route() calls", async () => {
    const bus = makeBus();
    const auditor = makeCapturingAuditor();
    const agg = createManoAggregator(bus, DEFAULT_MANO_AGGREGATOR_CONFIG, undefined, undefined, undefined, auditor);

    const extrasArbiter: IGearArbiter = {
      id: 'extras-arbiter',
      priority: 10,
      evaluate: () => {
        bus.emit({
          type: 'audit:context_contribute',
          timestamp: Date.now(),
          payload: { key: 'route1.key', value: 'first' },
        });
        return { action: 1, confidence: 0.80, riskCategory: 'informational' as const };
      },
    };

    await agg.route(makeContext(), [extrasArbiter]);
    const ctx1 = auditor.capturedContext as AuditContext;
    expect(ctx1.extras.get('route1.key')).toBe('first');

    // Second route with different arbiter
    const plainArbiter = makeArbiter("plain", 1, 0.80, 'informational');
    await agg.route(makeContext(), [plainArbiter]);
    const ctx2 = auditor.capturedContext as AuditContext;
    expect(ctx2.extras.has('route1.key')).toBe(false);
  });
});
