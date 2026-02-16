/**
 * JSON-RPC message protocol for main thread <-> worker communication.
 */

/** Base message structure */
export interface SandboxMessageBase {
  type: string;
  id?: string;
  replyTo?: string;
}

/** Main -> Worker: Initialize plugin */
export interface InitPluginMessage extends SandboxMessageBase {
  type: "INIT_PLUGIN";
  payload: {
    pluginPath: string;
    config: Record<string, unknown>;
    context: SerializedPluginContext;
  };
}

/** Worker -> Main: Plugin initialization complete */
export interface InitCompleteMessage extends SandboxMessageBase {
  type: "INIT_COMPLETE";
  payload: {
    success: boolean;
    error?: string;
    hooks: SerializedPluginHooks;
  };
}

/** Main -> Worker: Execute tool */
export interface InvokeToolMessage extends SandboxMessageBase {
  type: "INVOKE_TOOL";
  payload: {
    toolId: string;
    input: unknown;
    context: SerializedToolContext;
  };
}

/** Worker -> Main: Tool execution result */
export interface ToolResultMessage extends SandboxMessageBase {
  type: "TOOL_RESULT";
  payload: {
    success: boolean;
    result?: string;
    error?: string;
  };
}

/** Worker -> Main: Emit event on EventBus */
export interface BusEmitMessage extends SandboxMessageBase {
  type: "BUS_EMIT";
  payload: {
    event: SerializedAgentEvent;
  };
}

/** Worker -> Main: Push input event */
export interface PushInputMessage extends SandboxMessageBase {
  type: "PUSH_INPUT";
  payload: {
    inputEvent: SerializedInputEvent;
  };
}

/** Worker -> Main: Request session manager operation */
export interface SessionRequestMessage extends SandboxMessageBase {
  type: "SESSION_REQUEST";
  payload: {
    operation: "create" | "get" | "destroy" | "list";
    sessionId?: string;
  };
}

/** Main -> Worker: Session operation response */
export interface SessionResponseMessage extends SandboxMessageBase {
  type: "SESSION_RESPONSE";
  payload: {
    success: boolean;
    data?: unknown;
    error?: string;
  };
}

/** Worker -> Main: Request tools list */
export interface ToolsListRequestMessage extends SandboxMessageBase {
  type: "TOOLS_LIST_REQUEST";
}

/** Main -> Worker: Tools list response */
export interface ToolsListResponseMessage extends SandboxMessageBase {
  type: "TOOLS_LIST_RESPONSE";
  payload: {
    tools: SerializedTool[];
  };
}

/** Worker -> Main: Request guides list */
export interface GuidesListRequestMessage extends SandboxMessageBase {
  type: "GUIDES_LIST_REQUEST";
}

/** Main -> Worker: Guides list response */
export interface GuidesListResponseMessage extends SandboxMessageBase {
  type: "GUIDES_LIST_RESPONSE";
  payload: {
    guides: SerializedGuide[];
  };
}

/** Worker -> Main: Subscribe to EventBus events */
export interface BusSubscribeMessage extends SandboxMessageBase {
  type: "BUS_SUBSCRIBE";
  payload: {
    eventType: string;
    subscriptionId: string;
  };
}

/** Worker -> Main: Unsubscribe from EventBus events */
export interface BusUnsubscribeMessage extends SandboxMessageBase {
  type: "BUS_UNSUBSCRIBE";
  payload: {
    eventType: string;
    subscriptionId: string;
  };
}

/** Main -> Worker: Dispatch event from main thread EventBus */
export interface BusEventDispatchMessage extends SandboxMessageBase {
  type: "BUS_EVENT_DISPATCH";
  payload: {
    event: SerializedAgentEvent;
  };
}

/** Worker -> Main: Request tools.get() */
export interface ToolsGetRequestMessage extends SandboxMessageBase {
  type: "TOOLS_GET_REQUEST";
  payload: {
    toolId: string;
  };
}

/** Main -> Worker: tools.get() response */
export interface ToolsGetResponseMessage extends SandboxMessageBase {
  type: "TOOLS_GET_RESPONSE";
  payload: {
    tool: SerializedTool | null;
  };
}

/** Worker -> Main: Request guides list with content */
export interface GuidesGetRequestMessage extends SandboxMessageBase {
  type: "GUIDES_GET_REQUEST";
  payload: {
    guideId: string;
  };
}

/** Main -> Worker: guides.get() response */
export interface GuidesGetResponseMessage extends SandboxMessageBase {
  type: "GUIDES_GET_RESPONSE";
  payload: {
    guide: SerializedGuide | null;
  };
}

/** Worker -> Main: Request providers list */
export interface ProvidersListRequestMessage extends SandboxMessageBase {
  type: "PROVIDERS_LIST_REQUEST";
}

/** Main -> Worker: Providers list response */
export interface ProvidersListResponseMessage extends SandboxMessageBase {
  type: "PROVIDERS_LIST_RESPONSE";
  payload: {
    providers: SerializedProvider[];
  };
}

/** Worker -> Main: Request providers.get() */
export interface ProvidersGetRequestMessage extends SandboxMessageBase {
  type: "PROVIDERS_GET_REQUEST";
  payload: {
    providerId: string;
  };
}

/** Main -> Worker: providers.get() response */
export interface ProvidersGetResponseMessage extends SandboxMessageBase {
  type: "PROVIDERS_GET_RESPONSE";
  payload: {
    provider: SerializedProvider | null;
  };
}

/** Main -> Worker: Shutdown worker */
export interface ShutdownMessage extends SandboxMessageBase {
  type: "SHUTDOWN";
}

/** Worker -> Main: Heartbeat (for monitoring) */
export interface HeartbeatMessage extends SandboxMessageBase {
  type: "HEARTBEAT";
  payload: {
    timestamp: number;
  };
}

/** Main -> Worker: Reset worker to idle state (clear plugin) */
export interface ResetMessage extends SandboxMessageBase {
  type: "RESET";
}

/** Worker -> Main: Reset complete, ready for new plugin */
export interface ResetCompleteMessage extends SandboxMessageBase {
  type: "RESET_COMPLETE";
}

/** Union type for all messages */
export type SandboxMessage =
  | InitPluginMessage
  | InitCompleteMessage
  | InvokeToolMessage
  | ToolResultMessage
  | BusEmitMessage
  | BusSubscribeMessage
  | BusUnsubscribeMessage
  | BusEventDispatchMessage
  | PushInputMessage
  | SessionRequestMessage
  | SessionResponseMessage
  | ToolsListRequestMessage
  | ToolsListResponseMessage
  | ToolsGetRequestMessage
  | ToolsGetResponseMessage
  | GuidesListRequestMessage
  | GuidesListResponseMessage
  | GuidesGetRequestMessage
  | GuidesGetResponseMessage
  | ProvidersListRequestMessage
  | ProvidersListResponseMessage
  | ProvidersGetRequestMessage
  | ProvidersGetResponseMessage
  | ShutdownMessage
  | HeartbeatMessage
  | ResetMessage
  | ResetCompleteMessage;

/** Serialized versions of core types (stripped of non-serializable fields) */
export interface SerializedPluginContext {
  workingDirectory: string;
  agentId: string;
  config: Record<string, unknown>;
}

export interface SerializedToolContext {
  workingDirectory: string;
  allowedPaths: string[];
}

export interface SerializedAgentEvent {
  type: string;
  timestamp: number;
  payload?: unknown;
}

export interface SerializedInputEvent {
  source: string;
  inputType: string;
  data: unknown;
  replyTo?: string;
  sessionId?: string;
}

export interface SerializedPluginHooks {
  tools?: Array<{ id: string; description: string }>;
  providers?: Array<{ id: string; name: string }>;
  listeners?: Array<{ name: string }>;
  ui?: Array<{ id: string }>;
  guides?: Array<{ id: string; name: string }>;
  commands?: Array<{ name: string; description: string }>;
}

export interface SerializedTool {
  id: string;
  description: string;
  parametersSchema: Record<string, unknown>;
}

export interface SerializedGuide {
  id: string;
  content: string;
}

export interface SerializedProvider {
  id: string;
  name: string;
  models: Array<{ id: string; name?: string; contextWindow?: number }>;
}
