/**
 * MockHost - Type-safe IPluginContext mock for plugin unit tests.
 *
 * Provides a lightweight, working implementation of IPluginContext with:
 * - Fully functional EventBus (emit, on, once, onAny with handler invocation)
 * - Session management with in-memory storage
 * - Tool/Guide/Provider registries
 * - Input event capture
 * - Event capture utilities for test assertions
 */

import type {
  IPluginContext,
  ISession,
  ISessionManager,
  ITool,
  IGuide,
  IProvider,
  AgentEvent,
  InputEvent,
  EventHandler,
  IStateManager,
  Message,
} from "../index.js";

/**
 * MockHost configuration options.
 */
export interface MockHostOptions {
  /** Working directory for the mock context. Default: "/tmp/mock" */
  workingDirectory?: string;

  /** Agent ID for the mock context. Default: "mock-agent" */
  agentId?: string;

  /** Initial config object. Default: {} */
  config?: Record<string, unknown>;
}

/**
 * MockHost - Type-safe IPluginContext mock for plugin unit tests.
 *
 * @example
 * ```typescript
 * import { createMockHost } from "@openstarry/sdk/testing";
 * import { createMyPlugin } from "../index.js";
 *
 * const host = createMockHost({ config: { verbose: true } });
 * const ctx = host.createContext();
 * const plugin = createMyPlugin();
 * const hooks = await plugin.factory(ctx);
 * ```
 */
export class MockHost {
  private workingDirectory: string;
  private agentId: string;
  private config: Record<string, unknown>;

  private emittedEvents: AgentEvent[] = [];
  private inputEvents: InputEvent[] = [];

  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private anyHandlers: EventHandler[] = [];
  private onceHandlers: Set<EventHandler> = new Set();

  private sessions: Map<string, ISession> = new Map();
  private defaultSession: ISession;
  private sessionIdCounter = 0;

  private tools: Map<string, ITool> = new Map();
  private guides: IGuide[] = [];
  private providers: Map<string, IProvider> = new Map();

  /**
   * Create a new MockHost with optional configuration.
   */
  constructor(options: MockHostOptions = {}) {
    this.workingDirectory = options.workingDirectory ?? "/tmp/mock";
    this.agentId = options.agentId ?? "mock-agent";
    this.config = options.config ?? {};

    this.defaultSession = this.createSessionInternal("default", {
      _isDefault: true,
    });
  }

  /**
   * Create an IPluginContext instance backed by this MockHost.
   * Returns a fully type-safe IPluginContext with working EventBus and sessions.
   */
  createContext(): IPluginContext {
    return {
      bus: {
        on: (type: string, handler: EventHandler) => {
          let handlers = this.eventHandlers.get(type);
          if (!handlers) {
            handlers = [];
            this.eventHandlers.set(type, handlers);
          }
          handlers.push(handler);

          return () => {
            const idx = handlers.indexOf(handler);
            if (idx !== -1) {
              handlers.splice(idx, 1);
            }
            this.onceHandlers.delete(handler);
          };
        },

        once: (type: string, handler: EventHandler) => {
          let called = false;
          const wrappedHandler: EventHandler = async (event: AgentEvent) => {
            if (called) return;
            called = true;

            const handlers = this.eventHandlers.get(type);
            if (handlers) {
              const idx = handlers.indexOf(wrappedHandler);
              if (idx !== -1) {
                handlers.splice(idx, 1);
              }
            }

            await handler(event);
            this.onceHandlers.delete(handler);
          };

          this.onceHandlers.add(handler);

          let handlers = this.eventHandlers.get(type);
          if (!handlers) {
            handlers = [];
            this.eventHandlers.set(type, handlers);
          }
          handlers.push(wrappedHandler);

          return () => {
            const handlers = this.eventHandlers.get(type);
            if (handlers) {
              const idx = handlers.indexOf(wrappedHandler);
              if (idx !== -1) {
                handlers.splice(idx, 1);
              }
            }
            this.onceHandlers.delete(handler);
          };
        },

        onAny: (handler: EventHandler) => {
          this.anyHandlers.push(handler);

          return () => {
            const idx = this.anyHandlers.indexOf(handler);
            if (idx !== -1) {
              this.anyHandlers.splice(idx, 1);
            }
          };
        },

        emit: (event: AgentEvent) => {
          this.emittedEvents.push(event);

          const handlers = this.eventHandlers.get(event.type) ?? [];
          for (const handler of handlers) {
            try {
              void handler(event);
            } catch (err) {
              // Suppress handler errors in mock
            }
          }

          for (const handler of this.anyHandlers) {
            try {
              void handler(event);
            } catch (err) {
              // Suppress handler errors in mock
            }
          }
        },
      },

      workingDirectory: this.workingDirectory,
      agentId: this.agentId,
      config: this.config,

      pushInput: (event: InputEvent) => {
        this.inputEvents.push(event);
      },

      sessions: this.createSessionManager(),

      tools: {
        list: () => Array.from(this.tools.values()),
        get: (id: string) => this.tools.get(id),
      },

      guides: {
        list: () => [...this.guides],
      },

      providers: {
        list: () => Array.from(this.providers.values()),
        get: (id: string) => this.providers.get(id),
      },
    };
  }

  /**
   * Emit an event from the host (simulates core event emission).
   * Triggers all registered handlers (on, once, onAny).
   */
  emitEvent(event: AgentEvent): void {
    const ctx = this.createContext();
    ctx.bus.emit(event);
  }

  /**
   * Register a tool in the mock tool registry.
   * Makes the tool available via ctx.tools.get() and ctx.tools.list().
   */
  registerTool(tool: ITool): void {
    this.tools.set(tool.id, tool);
  }

  /**
   * Register a guide in the mock guide registry.
   * Makes the guide available via ctx.guides.list().
   */
  registerGuide(guide: IGuide): void {
    this.guides.push(guide);
  }

  /**
   * Register a provider in the mock provider registry.
   * Makes the provider available via ctx.providers.get() and ctx.providers.list().
   */
  registerProvider(provider: IProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Create a new session in the mock session manager.
   * If id is not provided, generates a unique ID.
   * Returns the created session.
   */
  createSession(id?: string, metadata?: Record<string, unknown>): ISession {
    const sessionId = id ?? `session-${++this.sessionIdCounter}`;
    const session = this.createSessionInternal(sessionId, metadata);
    return session;
  }

  /**
   * Get all events emitted via ctx.bus.emit() since last clear.
   * Returns events in emission order.
   */
  getEmittedEvents(): AgentEvent[] {
    return [...this.emittedEvents];
  }

  /**
   * Get all input events pushed via ctx.pushInput() since last clear.
   * Returns events in push order.
   */
  getInputEvents(): InputEvent[] {
    return [...this.inputEvents];
  }

  /**
   * Clear all captured events (emitted + input).
   * Does not clear registered handlers or sessions.
   */
  clearEvents(): void {
    this.emittedEvents = [];
    this.inputEvents = [];
  }

  /**
   * Get all registered event handlers (for debugging).
   * Returns a map of event type to handler count.
   */
  getHandlerCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [type, handlers] of this.eventHandlers.entries()) {
      counts[type] = handlers.length;
    }
    if (this.anyHandlers.length > 0) {
      counts["*"] = this.anyHandlers.length;
    }
    return counts;
  }

  private createSessionInternal(
    id: string,
    metadata?: Record<string, unknown>,
  ): ISession {
    const session: ISession = {
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: metadata ?? {},
    };
    this.sessions.set(id, session);
    return session;
  }

  private createSessionManager(): ISessionManager {
    return {
      create: (metadata?: Record<string, unknown>) => {
        const id = `session-${++this.sessionIdCounter}`;
        return this.createSessionInternal(id, metadata);
      },

      get: (sessionId: string) => {
        return this.sessions.get(sessionId);
      },

      list: () => {
        return Array.from(this.sessions.values());
      },

      destroy: (sessionId: string) => {
        if (sessionId === this.defaultSession.id) {
          return false;
        }
        return this.sessions.delete(sessionId);
      },

      getStateManager: (_sessionId?: string): IStateManager => {
        return {
          getMessages: () => [],
          addMessage: (_message: Message) => {},
          clear: () => {},
          snapshot: () => [],
          restore: (_snapshot: Message[]) => {},
        };
      },

      getDefaultSession: () => {
        return this.defaultSession;
      },
    };
  }
}

/**
 * Convenience factory function for creating a MockHost.
 * Equivalent to `new MockHost(options)`.
 */
export function createMockHost(options?: MockHostOptions): MockHost {
  return new MockHost(options);
}
