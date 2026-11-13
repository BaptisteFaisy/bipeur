/** The MCP server itself: a name, a version, three tools (BIP-F-26). */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './tools.js';
import type { BipeurService } from './service.js';

export const SERVER_NAME = 'bipeur';
export const SERVER_VERSION = '0.1.0';

export function createBipeurServer(service: BipeurService): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, service);
  return server;
}
