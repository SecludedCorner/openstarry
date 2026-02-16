import { describe, it, expect } from "vitest";
import type { IPluginContext, IProvider } from "../../index.js";

describe("IPluginContext type", () => {
  describe("providers accessor", () => {
    it("should have optional providers accessor with list/get methods", () => {
      const mockProvider: IProvider = {
        id: "test-provider",
        name: "Test Provider",
        models: [{ id: "test-model", name: "Test Model" }],
        chat: async function* () {
          yield { type: "text_delta" as const, text: "test" };
        },
      };

      const ctx: IPluginContext = {
        bus: {
          emit: () => {},
          on: () => () => {},
          once: () => () => {},
          onAny: () => () => {},
        },
        workingDirectory: "/test",
        agentId: "test-agent",
        config: {},
        pushInput: () => {},
        sessions: {
          create: () => ({ id: "test", createdAt: 0, updatedAt: 0, metadata: {} }),
          get: () => undefined,
          list: () => [],
          destroy: () => false,
          getStateManager: () => ({
            getMessages: () => [],
            addMessage: () => {},
            clear: () => {},
            snapshot: () => [],
            restore: () => {},
          }),
          getDefaultSession: () => ({ id: "default", createdAt: 0, updatedAt: 0, metadata: {} }),
        },
        providers: {
          list: () => [mockProvider],
          get: (id: string) => (id === "test-provider" ? mockProvider : undefined),
        },
      };

      // Verify the shape
      expect(ctx.providers).toBeDefined();
      expect(typeof ctx.providers?.list).toBe("function");
      expect(typeof ctx.providers?.get).toBe("function");

      // Verify functionality
      expect(ctx.providers?.list()).toHaveLength(1);
      expect(ctx.providers?.list()[0].id).toBe("test-provider");
      expect(ctx.providers?.get("test-provider")).toEqual(mockProvider);
      expect(ctx.providers?.get("non-existent")).toBeUndefined();
    });

    it("should work without providers accessor (backward compat)", () => {
      const ctx: IPluginContext = {
        bus: {
          emit: () => {},
          on: () => () => {},
          once: () => () => {},
          onAny: () => () => {},
        },
        workingDirectory: "/test",
        agentId: "test-agent",
        config: {},
        pushInput: () => {},
        sessions: {
          create: () => ({ id: "test", createdAt: 0, updatedAt: 0, metadata: {} }),
          get: () => undefined,
          list: () => [],
          destroy: () => false,
          getStateManager: () => ({
            getMessages: () => [],
            addMessage: () => {},
            clear: () => {},
            snapshot: () => [],
            restore: () => {},
          }),
          getDefaultSession: () => ({ id: "default", createdAt: 0, updatedAt: 0, metadata: {} }),
        },
        // No providers field — should be fine due to optional marker
      };

      expect(ctx.providers).toBeUndefined();
    });

    it("should follow the same pattern as tools accessor", () => {
      const ctx: IPluginContext = {
        bus: {
          emit: () => {},
          on: () => () => {},
          once: () => () => {},
          onAny: () => () => {},
        },
        workingDirectory: "/test",
        agentId: "test-agent",
        config: {},
        pushInput: () => {},
        sessions: {
          create: () => ({ id: "test", createdAt: 0, updatedAt: 0, metadata: {} }),
          get: () => undefined,
          list: () => [],
          destroy: () => false,
          getStateManager: () => ({
            getMessages: () => [],
            addMessage: () => {},
            clear: () => {},
            snapshot: () => [],
            restore: () => {},
          }),
          getDefaultSession: () => ({ id: "default", createdAt: 0, updatedAt: 0, metadata: {} }),
        },
        tools: {
          list: () => [],
          get: () => undefined,
        },
        providers: {
          list: () => [],
          get: () => undefined,
        },
      };

      // Both should have list() and get() methods
      expect(typeof ctx.tools?.list).toBe("function");
      expect(typeof ctx.tools?.get).toBe("function");
      expect(typeof ctx.providers?.list).toBe("function");
      expect(typeof ctx.providers?.get).toBe("function");

      // Both should return empty arrays/undefined when empty
      expect(ctx.tools?.list()).toEqual([]);
      expect(ctx.tools?.get("any")).toBeUndefined();
      expect(ctx.providers?.list()).toEqual([]);
      expect(ctx.providers?.get("any")).toBeUndefined();
    });
  });
});
