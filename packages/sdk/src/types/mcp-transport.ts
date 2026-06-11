/**
 * IMcpTransport — MCP server registration and hub transport interface.
 *
 * FROZEN: Architecture Review (2026-03-24, Cycle 20260324_cycle03-1).
 * Any changes require a new Spec Addendum through the Coordinator.
 *
 * Plan37 C15: MCP transport interface for multi-agent MCP server discovery.
 */

/**
 * Endpoint descriptor for an agent's MCP server.
 */
export interface McpServerEndpoint {
  /** Agent ID that owns this MCP server. */
  agentId: string;

  /** Transport type: 'http', 'stdio', etc. */
  transport: string;

  /** URL for HTTP/WebSocket transports (optional). */
  url?: string;

  /** Command for stdio transport (optional). */
  command?: string;

  /** Arguments for stdio transport (optional). */
  args?: string[];

  /** Tool names exposed by this MCP server. */
  exposedTools: string[];
}

/**
 * Represents a live client connection to a remote MCP server.
 */
export interface McpClientConnection {
  /** Unique endpoint identifier (typically agentId:transport or a URL). */
  endpointId: string;

  /** Connection status. */
  status: 'connected' | 'disconnected' | 'error';

  /** Capabilities advertised by the remote MCP server. */
  capabilities: string[];
}

/**
 * MCP transport interface for registering agents as MCP servers
 * and connecting to other agents' MCP servers.
 *
 * FROZEN: Architecture Review (2026-03-24, Cycle 20260324_cycle03-1).
 */
export interface IMcpTransport {
  /** Information about this agent's own MCP server endpoint. */
  readonly serverInfo: McpServerEndpoint;

  /** Currently connected remote MCP servers. */
  readonly connectedServers: McpClientConnection[];

  /**
   * Register this agent's MCP server with the hub (Daemon).
   * Makes this agent discoverable by other agents.
   */
  registerWithHub(): Promise<void>;

  /**
   * Deregister this agent's MCP server from the hub.
   */
  deregisterFromHub(): Promise<void>;

  /**
   * Connect to a remote agent's MCP server.
   * @param endpointId - The endpoint identifier to connect to.
   * @returns The established connection.
   */
  connectTo(endpointId: string): Promise<McpClientConnection>;

  /**
   * Disconnect from a remote agent's MCP server.
   * @param endpointId - The endpoint identifier to disconnect from.
   */
  disconnectFrom(endpointId: string): Promise<void>;
}
