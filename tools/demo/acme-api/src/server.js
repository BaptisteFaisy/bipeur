/**
 * acme-api — a very small HTTP service. It exists so the demo agent has
 * something real to release: a version, a changelog, a server, a test.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const server = createServer((request, response) => {
  if (request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, version: pkg.version }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not_found' }));
});

const port = Number(process.env.PORT ?? 8788);
server.listen(port, () => {
  process.stdout.write(`acme-api ${pkg.version} on http://127.0.0.1:${port}\n`);
});
