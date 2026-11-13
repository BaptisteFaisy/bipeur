/**
 * The two transports of A.9: stdio for a local client, Streamable HTTP for a
 * remote one. HTTP runs stateless — one server per request — so a restart of
 * the agent never leaves a dangling session behind.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export type ServerFactory = () => McpServer;

export async function runStdioServer(factory: ServerFactory): Promise<void> {
  const server = factory();
  await server.connect(new StdioServerTransport());
}

export interface HttpOptions {
  host: string;
  port: number;
}

export async function runHttpServer(factory: ServerFactory, options: HttpOptions): Promise<number> {
  const http = createServer((request, response) => {
    void handle(factory, request, response);
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port, options.host, resolve);
  });
  return addressPort(http, options.port);
}

async function handle(
  factory: ServerFactory,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, name: 'bipeur-mcp' }));
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'invalid JSON body' }));
    return;
  }
  const server = factory();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  response.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(request, response, body);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.method !== 'POST') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Buffer));
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text.length === 0) return undefined;
  return JSON.parse(text) as unknown;
}

function addressPort(server: Server, fallback: number): number {
  const address = server.address();
  return address && typeof address === 'object' ? address.port : fallback;
}
