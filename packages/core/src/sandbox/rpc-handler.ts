/**
 * Main-thread RPC handler — processes messages from sandbox workers.
 */

import type { Worker } from "node:worker_threads";
import type { EventBus, InputEvent, ISessionManager, ITool, IGuide, IProvider } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";
import type {
  SandboxMessage,
  BusEmitMessage,
  BusSubscribeMessage,
  BusUnsubscribeMessage,
  PushInputMessage,
  SessionRequestMessage,
  ToolsListRequestMessage,
  ToolsGetRequestMessage,
  GuidesListRequestMessage,
  GuidesGetRequestMessage,
  ProvidersListRequestMessage,
  ProvidersGetRequestMessage,
} from "./messages.js";
import type { AuditLogger } from "./audit-logger.js";

const logger = createLogger("SandboxRPC");

export interface RpcHandlerDeps {
  bus: EventBus;
  pushInput: (event: InputEvent) => void;
  sessions: ISessionManager;
  tools: {
    list(): ITool[];
    get(id: string): ITool | undefined;
  };
  guides: {
    list(): IGuide[];
  };
  providers: {
    list(): IProvider[];
    get(id: string): IProvider | undefined;
  };
}

/** Shared subscription state between rpc-handler and sandbox-manager. */
export interface SubscriptionState {
  subscriptions: Map<string, Set<string>>;
}

/**
 * Wire up RPC message handling for a sandbox worker.
 * Returns a cleanup function to remove the listener.
 */
export function attachRpcHandler(
  worker: Worker,
  pluginName: string,
  deps: RpcHandlerDeps,
  subscriptionState?: SubscriptionState,
  auditLogger?: AuditLogger,
): () => void {
  const handler = async (msg: SandboxMessage) => {
    if (!msg || typeof msg.type !== "string") return;

    // Start audit log entry (if logger available)
    const operationId = auditLogger?.logRpcStart(
      msg.type,
      msg.type,
      (msg as any).payload,
    );

    try {
      switch (msg.type) {
        case "BUS_EMIT":
          handleBusEmit(msg, deps);
          break;
        case "BUS_SUBSCRIBE":
          if (subscriptionState) {
            handleBusSubscribe(msg, subscriptionState);
          }
          break;
        case "BUS_UNSUBSCRIBE":
          if (subscriptionState) {
            handleBusUnsubscribe(msg, subscriptionState);
          }
          break;
        case "PUSH_INPUT":
          handlePushInput(msg, deps);
          break;
        case "SESSION_REQUEST":
          await handleSessionRequest(worker, msg, deps);
          break;
        case "TOOLS_LIST_REQUEST":
          handleToolsListRequest(worker, msg, deps);
          break;
        case "TOOLS_GET_REQUEST":
          handleToolsGetRequest(worker, msg, deps);
          break;
        case "GUIDES_LIST_REQUEST":
          await handleGuidesListRequest(worker, msg, deps);
          break;
        case "GUIDES_GET_REQUEST":
          await handleGuidesGetRequest(worker, msg, deps);
          break;
        case "PROVIDERS_LIST_REQUEST":
          handleProvidersListRequest(worker, msg, deps);
          break;
        case "PROVIDERS_GET_REQUEST":
          handleProvidersGetRequest(worker, msg, deps);
          break;
        default:
          // INIT_COMPLETE, TOOL_RESULT, HEARTBEAT, BUS_EVENT_DISPATCH handled by sandbox-manager
          break;
      }

      // End audit log entry (success)
      if (operationId) {
        auditLogger?.logRpcEnd(operationId, "success");
      }
    } catch (err) {
      // End audit log entry (error)
      if (operationId) {
        auditLogger?.logRpcEnd(operationId, "error", String(err));
      }
      throw err;
    }
  };

  const wrappedHandler = (msg: SandboxMessage) => {
    void handler(msg);
  };

  worker.on("message", wrappedHandler);
  return () => worker.off("message", wrappedHandler);
}

function handleBusEmit(msg: BusEmitMessage, deps: RpcHandlerDeps): void {
  try {
    deps.bus.emit({
      type: msg.payload.event.type,
      timestamp: msg.payload.event.timestamp,
      payload: msg.payload.event.payload,
    });
  } catch (err) {
    logger.error("Failed to emit bus event from sandbox", { error: String(err) });
  }
}

function handleBusSubscribe(msg: BusSubscribeMessage, state: SubscriptionState): void {
  const { eventType, subscriptionId } = msg.payload;
  if (!state.subscriptions.has(eventType)) {
    state.subscriptions.set(eventType, new Set());
  }
  state.subscriptions.get(eventType)!.add(subscriptionId);
}

function handleBusUnsubscribe(msg: BusUnsubscribeMessage, state: SubscriptionState): void {
  const { eventType, subscriptionId } = msg.payload;
  const subs = state.subscriptions.get(eventType);
  if (subs) {
    subs.delete(subscriptionId);
    if (subs.size === 0) {
      state.subscriptions.delete(eventType);
    }
  }
}

function handlePushInput(msg: PushInputMessage, deps: RpcHandlerDeps): void {
  try {
    deps.pushInput({
      source: msg.payload.inputEvent.source,
      inputType: msg.payload.inputEvent.inputType,
      data: msg.payload.inputEvent.data,
      replyTo: msg.payload.inputEvent.replyTo,
      sessionId: msg.payload.inputEvent.sessionId,
    });
  } catch (err) {
    logger.error("Failed to push input from sandbox", { error: String(err) });
  }
}

async function handleSessionRequest(
  worker: Worker,
  msg: SessionRequestMessage,
  deps: RpcHandlerDeps,
): Promise<void> {
  try {
    let data: unknown;
    switch (msg.payload.operation) {
      case "create": {
        const session = deps.sessions.create();
        data = { id: session.id };
        break;
      }
      case "get": {
        const session = msg.payload.sessionId
          ? deps.sessions.get(msg.payload.sessionId)
          : undefined;
        data = session ? { id: session.id } : null;
        break;
      }
      case "destroy":
        if (msg.payload.sessionId) {
          deps.sessions.destroy(msg.payload.sessionId);
        }
        data = null;
        break;
      case "list": {
        const sessions = deps.sessions.list();
        data = sessions.map((s) => ({ id: s.id }));
        break;
      }
    }
    worker.postMessage({
      type: "SESSION_RESPONSE",
      replyTo: msg.id,
      payload: { success: true, data },
    });
  } catch (err) {
    worker.postMessage({
      type: "SESSION_RESPONSE",
      replyTo: msg.id,
      payload: { success: false, error: String(err) },
    });
  }
}

function handleToolsListRequest(
  worker: Worker,
  msg: ToolsListRequestMessage,
  deps: RpcHandlerDeps,
): void {
  try {
    const tools = deps.tools.list().map((t) => ({
      id: t.id,
      description: t.description,
      parametersSchema: t.parameters ? JSON.parse(JSON.stringify(t.parameters)) : {},
    }));
    worker.postMessage({
      type: "TOOLS_LIST_RESPONSE",
      replyTo: msg.id,
      payload: { tools },
    });
  } catch (err) {
    worker.postMessage({
      type: "TOOLS_LIST_RESPONSE",
      replyTo: msg.id,
      payload: { tools: [] },
    });
  }
}

function handleToolsGetRequest(
  worker: Worker,
  msg: ToolsGetRequestMessage,
  deps: RpcHandlerDeps,
): void {
  try {
    const tool = deps.tools.get(msg.payload.toolId);
    const serialized = tool
      ? {
          id: tool.id,
          description: tool.description,
          parametersSchema: tool.parameters ? JSON.parse(JSON.stringify(tool.parameters)) : {},
        }
      : null;
    worker.postMessage({
      type: "TOOLS_GET_RESPONSE",
      replyTo: msg.id,
      payload: { tool: serialized },
    });
  } catch (err) {
    worker.postMessage({
      type: "TOOLS_GET_RESPONSE",
      replyTo: msg.id,
      payload: { tool: null },
    });
  }
}

async function handleGuidesListRequest(
  worker: Worker,
  msg: GuidesListRequestMessage,
  deps: RpcHandlerDeps,
): Promise<void> {
  try {
    const guides = await Promise.all(
      deps.guides.list().map(async (g) => ({
        id: g.id,
        content: await g.getSystemPrompt(),
      })),
    );
    worker.postMessage({
      type: "GUIDES_LIST_RESPONSE",
      replyTo: msg.id,
      payload: { guides },
    });
  } catch (err) {
    worker.postMessage({
      type: "GUIDES_LIST_RESPONSE",
      replyTo: msg.id,
      payload: { guides: [] },
    });
  }
}

async function handleGuidesGetRequest(
  worker: Worker,
  msg: GuidesGetRequestMessage,
  deps: RpcHandlerDeps,
): Promise<void> {
  try {
    const guide = deps.guides.list().find((g) => g.id === msg.payload.guideId);
    const serialized = guide
      ? { id: guide.id, content: await guide.getSystemPrompt() }
      : null;
    worker.postMessage({
      type: "GUIDES_GET_RESPONSE",
      replyTo: msg.id,
      payload: { guide: serialized },
    });
  } catch (err) {
    worker.postMessage({
      type: "GUIDES_GET_RESPONSE",
      replyTo: msg.id,
      payload: { guide: null },
    });
  }
}

function handleProvidersListRequest(
  worker: Worker,
  msg: ProvidersListRequestMessage,
  deps: RpcHandlerDeps,
): void {
  try {
    const providers = deps.providers.list().map((p) => ({
      id: p.id,
      name: p.name,
      models: p.models.map((m) => ({
        id: m.id,
        name: m.name,
        contextWindow: m.contextWindow,
      })),
    }));
    worker.postMessage({
      type: "PROVIDERS_LIST_RESPONSE",
      replyTo: msg.id,
      payload: { providers },
    });
  } catch (err) {
    worker.postMessage({
      type: "PROVIDERS_LIST_RESPONSE",
      replyTo: msg.id,
      payload: { providers: [] },
    });
  }
}

function handleProvidersGetRequest(
  worker: Worker,
  msg: ProvidersGetRequestMessage,
  deps: RpcHandlerDeps,
): void {
  try {
    const provider = deps.providers.get(msg.payload.providerId);
    const serialized = provider
      ? {
          id: provider.id,
          name: provider.name,
          models: provider.models.map((m) => ({
            id: m.id,
            name: m.name,
            contextWindow: m.contextWindow,
          })),
        }
      : null;
    worker.postMessage({
      type: "PROVIDERS_GET_RESPONSE",
      replyTo: msg.id,
      payload: { provider: serialized },
    });
  } catch (err) {
    worker.postMessage({
      type: "PROVIDERS_GET_RESPONSE",
      replyTo: msg.id,
      payload: { provider: null },
    });
  }
}
