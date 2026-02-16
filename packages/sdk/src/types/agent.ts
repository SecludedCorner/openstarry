/**
 * Agent configuration types.
 */

/** Agent identity metadata. */
export interface AgentIdentity {
  id: string;
  name: string;
  description?: string;
  version?: string;
}

/** Cognition configuration — how the agent thinks. */
export interface CognitionConfig {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxToolRounds?: number;
}

/** Capabilities configuration — what the agent can do. */
export interface CapabilitiesConfig {
  tools: string[];
  allowedPaths?: string[];
}

/** Policy configuration — safety and security rules. */
export interface PolicyConfig {
  maxConcurrentTools?: number;
  toolTimeout?: number;
  pathRestrictions?: string[];
}

/** Memory configuration. */
export interface MemoryConfig {
  slidingWindowSize: number;
}

/** Session management configuration. */
export interface SessionConfig {
  /** Session persistence settings. */
  persistence?: {
    /** Enable session persistence to disk. */
    enabled?: boolean;
    /** Idle time-to-live in seconds. */
    idleTTL?: number;
    /** Maximum number of messages to store per session. */
    maxHistorySize?: number;
  };
  /** Number of messages to replay when attaching to existing session. */
  replayCount?: number;
}

/** The top-level agent configuration loaded from agent.json. */
export interface IAgentConfig {
  identity: AgentIdentity;
  cognition: CognitionConfig;
  capabilities: CapabilitiesConfig;
  policy?: PolicyConfig;
  memory?: MemoryConfig;
  session?: SessionConfig;
  plugins: PluginRef[];
  guide?: string;
}

/** A reference to a plugin to load. */
export interface PluginRef {
  name: string;
  path?: string;
  config?: Record<string, unknown>;
}
