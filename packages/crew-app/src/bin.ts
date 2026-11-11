#!/usr/bin/env node
/** Background process of the Crew app: relay Gateway events to the pager. */
import { createCrewAuth } from './auth.js';
import { createBeeperClient } from './beeper.js';
import { loadConfig } from './config.js';
import { relay } from './relay.js';

const config = loadConfig();
if (config.beeperToken.length === 0) {
  process.stderr.write('crew-app: BIPEUR_TOKEN is required\n');
  process.exit(2);
}

const client = createBeeperClient({ baseUrl: config.beeperUrl, token: config.beeperToken });
const auth = createCrewAuth(config, process.env);
const app = relay(config, client, { auth });
process.stdout.write(
  `crew-app: ${config.gatewayUrl} (app ${config.appName}) -> ${config.beeperUrl} (station ${config.station})\n`,
);

const shutdown = (): void => {
  app.stop();
  process.exitCode = 0;
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
