/**
 * Worker-side proxy that implements IPluginContext via RPC to main thread.
 * Runs inside worker_threads, sends messages to main thread for actual operations.
 */

import type {
  IPluginContext,
  EventBus,
  EventHandler,
  AgentEvent,
  InputEvent,
  ISessionManager,
  ISession,
  ITool,
  IGuide,
  IProvider,
} from "@openstarry/sdk";
import type { MessagePort } from "node:worker_threads";
import type {
  SerializedPluginContext,
  BusEventDispatchMessage,
  ToolsListResponseMessage,
  ToolsGetResponseMessage,
  GuidesListResponseMessage,
  GuidesGetResponseMessage,
  ProvidersListResponseMessage,
  ProvidersGetResponseMessage,
  SessionResponseMessage,
} from "./messages.js";
import type { IStateManager } from "@openstarry/sdk";

let rpcIdCounter = 0;

function nextRpcId(): string {
  return `rpc-${++rpcIdCounter}-${Date.now()}`;
}

/**
 * Send an RPC request via parentPort and wait for a matching response.
 */
function rpcRequest(
  parentPort: MessagePort,
  type: string,
  payload: Record<string, unknown>,
  replyType: string,
  timeoutMs = 30000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextRpcId();
    const timer = setTimeout(() => {
      parentPort.off("message", handler);
      reject(new Error(`RPC timeout: ${type} (${id})`));
    }, timeoutMs);

    function handler(msg: { type: string; replyTo?: string; payload?: unknown }) {
      if (msg.type === replyType && msg.replyTo === id) {
        clearTimeout(timer);
        parentPort.off("message", handler);
        resolve(msg.payload);
      }
    }

    parentPort.on("message", handler);
    parentPort.postMessage({ type, id, payload });
  });
}

let subIdCounter = 0;

function nextSubId(): string {
  return `sub-${++subIdCounter}-${Date.now()}`;
}

/**
 * Create a proxy IPluginContext for use in a sandbox worker.
 */
export function createPluginContextProxy(
  parentPort: MessagePort,
  serializedContext: SerializedPluginContext,
): IPluginContext {
  // ─── Bidirectional EventBus ───
  // Local handler map: eventType -> Map<subscriptionId, handler>
  const localHandlers = new Map<string, Map<string, EventHandler>>();

  // Listen for dispatched events from main thread
  parentPort.on("message", (msg: BusEventDispatchMessage) => {
    if (!msg || msg.type !== "BUS_EVENT_DISPATCH") return;

    const event: AgentEvent = {
      type: msg.payload.event.type,
      timestamp: msg.payload.event.timestamp,
      payload: msg.payload.event.payload,
    };

    // Dispatch to specific type handlers
    const typeHandlers = localHandlers.get(event.type);
    if (typeHandlers) {
      for (const [, handler] of typeHandlers) {
        try { handler(event); } catch { /* best-effort */ }
      }
    }

    // Dispatch to wildcard handlers
    const wildcardHandlers = localHandlers.get("*");
    if (wildcardHandlers) {
      for (const [, handler] of wildcardHandlers) {
        try { handler(event); } catch { /* best-effort */ }
      }
    }
  });

  const busProxy: EventBus = {
    emit(event: AgentEvent): void {
      parentPort.postMessage({
        type: "BUS_EMIT",
        payload: {
          event: {
            type: event.type,
            timestamp: event.timestamp,
            payload: event.payload,
          },
        },
      });
    },

    on(type: string, handler: EventHandler): () => void {
      const subscriptionId = nextSubId();

      // Store handler locally
      if (!localHandlers.has(type)) {
        localHandlers.set(type, new Map());
      }
      localHandlers.get(type)!.set(subscriptionId, handler);

      // Notify main thread
      parentPort.postMessage({
        type: "BUS_SUBSCRIBE",
        payload: { eventType: type, subscriptionId },
      });

      // Return cleanup function
      return () => {
        const handlers = localHandlers.get(type);
        if (handlers) {
          handlers.delete(subscriptionId);
          if (handlers.size === 0) {
            localHandlers.delete(type);
          }
        }
        parentPort.postMessage({
          type: "BUS_UNSUBSCRIBE",
          payload: { eventType: type, subscriptionId },
        });
      };
    },

    once(type: string, handler: EventHandler): () => void {
      let unsubscribe: (() => void) | undefined;
      const wrappedHandler: EventHandler = (event) => {
        if (unsubscribe) unsubscribe();
        handler(event);
      };
      unsubscribe = busProxy.on(type, wrappedHandler);
      return unsubscribe;
    },

    onAny(handler: EventHandler): () => void {
      return busProxy.on("*", handler);
    },
  };

  const pushInput = (event: InputEvent): void => {
    parentPort.postMessage({
      type: "PUSH_INPUT",
      payload: {
        inputEvent: {
          source: event.source,
          inputType: event.inputType,
          data: event.data,
          replyTo: event.replyTo,
          sessionId: event.sessionId,
        },
      },
    });
  };

  // Minimal state manager stub (sessions in worker only get proxied metadata)
  const stubStateManager: IStateManager = {
    getMessages: () => [],
    addMessage: () => {},
    clear: () => {},
    snapshot: () => [],
    restore: () => {},
  };

  // ─── Sessions Proxy (async via RPC) ───

  const sessionsProxy: ISessionManager = {
    create(metadata?: Record<string, unknown>): ISession {
      // Fire-and-forget session creation; return a stub
      parentPort.postMessage({
        type: "SESSION_REQUEST",
        id: nextRpcId(),
        payload: { operation: "create", metadata },
      });
      return {
        id: `pending-${Date.now()}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: metadata ?? {},
      };
    },
    get(sessionId: string): ISession | undefined {
      // Sync API limitation — use asyncGet() internally if available
      // For now: fire RPC and return undefined (callers should use async patterns)
      void sessionId;
      return undefined;
    },
    list(): ISession[] {
      // Sync API limitation — return empty
      return [];
    },
    destroy(sessionId: string): boolean {
      parentPort.postMessage({
        type: "SESSION_REQUEST",
        id: nextRpcId(),
        payload: { operation: "destroy", sessionId },
      });
      return true;
    },
    getStateManager(): IStateManager {
      return stubStateManager;
    },
    getDefaultSession(): ISession {
      return {
        id: "default",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {},
      };
    },
  };

  // ─── Async Tools Proxy ───

  const toolsProxy = {
    list(): ITool[] {
      // Sync stub — returns empty. Use asyncList() for actual data.
      return [];
    },
    get(_id: string): ITool | undefined {
      // Sync stub — returns undefined. Use asyncGet() for actual data.
      return undefined;
    },
    async asyncList(): Promise<Array<{ id: string; description: string }>> {
      const response = await rpcRequest(
        parentPort,
        "TOOLS_LIST_REQUEST",
        {},
        "TOOLS_LIST_RESPONSE",
      ) as ToolsListResponseMessage["payload"];
      return response.tools;
    },
    async asyncGet(id: string): Promise<{ id: string; description: string } | null> {
      const response = await rpcRequest(
        parentPort,
        "TOOLS_GET_REQUEST",
        { toolId: id },
        "TOOLS_GET_RESPONSE",
      ) as ToolsGetResponseMessage["payload"];
      return response.tool;
    },
  };

  // ─── Async Guides Proxy ───

  const guidesProxy = {
    list(): IGuide[] {
      // Sync stub — returns empty. Use asyncList() for actual data.
      return [];
    },
    async asyncList(): Promise<Array<{ id: string; content: string }>> {
      const response = await rpcRequest(
        parentPort,
        "GUIDES_LIST_REQUEST",
        {},
        "GUIDES_LIST_RESPONSE",
      ) as GuidesListResponseMessage["payload"];
      return response.guides;
    },
    async asyncGet(id: string): Promise<{ id: string; content: string } | null> {
      const response = await rpcRequest(
        parentPort,
        "GUIDES_GET_REQUEST",
        { guideId: id },
        "GUIDES_GET_RESPONSE",
      ) as GuidesGetResponseMessage["payload"];
      return response.guide;
    },
  };

  // ─── Async Providers Proxy ───

  const providersProxy = {
    list(): IProvider[] {
      // Sync stub — returns empty. Use asyncList() for actual data.
      return [];
    },
    get(_id: string): IProvider | undefined {
      // Sync stub — returns undefined. Use asyncGet() for actual data.
      return undefined;
    },
    async asyncList(): Promise<Array<{ id: string; name: string; models: Array<{ id: string; name?: string; contextWindow?: number }> }>> {
      const response = await rpcRequest(
        parentPort,
        "PROVIDERS_LIST_REQUEST",
        {},
        "PROVIDERS_LIST_RESPONSE",
      ) as ProvidersListResponseMessage["payload"];
      return response.providers;
    },
    async asyncGet(id: string): Promise<{ id: string; name: string; models: Array<{ id: string; name?: string; contextWindow?: number }> } | null> {
      const response = await rpcRequest(
        parentPort,
        "PROVIDERS_GET_REQUEST",
        { providerId: id },
        "PROVIDERS_GET_RESPONSE",
      ) as ProvidersGetResponseMessage["payload"];
      return response.provider;
    },
  };

  return {
    bus: busProxy,
    workingDirectory: serializedContext.workingDirectory,
    agentId: serializedContext.agentId,
    config: serializedContext.config,
    pushInput,
    sessions: sessionsProxy,
    tools: toolsProxy,
    guides: guidesProxy,
    providers: providersProxy,
  };
}
