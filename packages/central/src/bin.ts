/**
 * Entry point: boot the Central, print the station token when it was generated,
 * and shut down cleanly on SIGTERM (the store is closed, the WAL is flushed).
 */
import { loadConfig } from './config.js';
import { createServer } from './server.js';

const config = loadConfig();
const central = await createServer(config);
const { url } = await central.listen();

console.log(`[central] listening on ${url}`);
console.log(`[central] database ${config.dbPath}`);
console.log(`[central] rules ${config.rulesPath}`);
console.log(`[central] budget ${config.budgetPerHour}/h, retention ${config.retentionDays}d`);
if (central.bootstrapToken) {
  console.log('[central] station token generated, shown once:');
  console.log(central.bootstrapToken);
}
if (config.demo) console.log('[central] demo mode is on (POST /v1/demo/start)');

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  console.log(`[central] ${signal} received, shutting down`);
  await central.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
