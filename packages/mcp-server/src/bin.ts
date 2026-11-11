#!/usr/bin/env node
/**
 * `bipeur-mcp` — the executable an MCP client launches. It only wires the
 * configuration to a service and a transport; everything else is testable.
 */
import { BipeurClient } from './client.js';
import { MCP_USAGE, parseMcpArgs } from './config.js';
import { BipeurService } from './service.js';
import { createBipeurServer } from './server.js';
import { runHttpServer, runStdioServer } from './transports.js';

const parsed = parseMcpArgs(process.argv.slice(2), process.env);

if (parsed.kind === 'help') {
  process.stdout.write(`${MCP_USAGE}\n`);
  process.exitCode = 0;
} else if (parsed.kind === 'error') {
  process.stderr.write(`bipeur-mcp: ${parsed.reason}\n`);
  process.exitCode = 2;
} else {
  const { config } = parsed;
  const service = new BipeurService(
    new BipeurClient({ url: config.url, token: config.token }),
  );
  const factory = () => createBipeurServer(service);
  if (config.transport === 'http') {
    const port = await runHttpServer(factory, { host: config.host, port: config.port });
    process.stderr.write(`bipeur-mcp: listening on http://${config.host}:${port}\n`);
  } else {
    await runStdioServer(factory);
  }
}
