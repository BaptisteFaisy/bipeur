#!/usr/bin/env node
/** Background process of the Crew app: relay Gateway events to the pager. */
import { createBeeperClient } from './beeper.js';
import { loadConfig } from './config.js';
import { relay } from './relay.js';

const config = loadConfig();
if (config.beeperToken.length === 0) {
  process.stderr.write('crew-app: BIPEUR_TOKEN is required\n');
  process.exit(2);
}

const client = createBeeperClient({ baseUrl: config.beeperUrl, token: config.beeperToken });
const app = relay(config, client);
process.stdout.write(`crew-app: ${config.gatewayUrl} -> ${config.beeperUrl} (station ${config.station})\n`);

const shutdown = (): void => {
  app.stop();
  process.exitCode = 0;
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
