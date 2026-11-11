#!/usr/bin/env node
/**
 * `bipeur-snpp` — the RFC 1861 gateway, standalone.
 *
 *   BIPEUR_SNPP_HOST=127.0.0.1 BIPEUR_SNPP_PORT=4440 \
 *   BIPEUR_URL=http://127.0.0.1:8787 BIPEUR_TOKEN=bip_… bipeur-snpp
 *
 * `--help` prints the demonstration session: `nc 127.0.0.1 4440` and type it.
 */
import { ConfigError, loadConfig } from './config.js';
import { httpBeeperClient } from './client.js';
import { createGateway, type SnppGateway } from './gateway.js';
import { formatTranscript } from './transcript.js';

const HELP = `bipeur-snpp — SNPP level 3 (RFC 1861) gateway for Beeper

Usage: bipeur-snpp [--help]

Environment
  BIPEUR_SNPP_HOST    listen address, default 127.0.0.1 (plaintext: loopback only)
  BIPEUR_SNPP_PORT    listen port, default 4440 (444 is privileged and historical)
  BIPEUR_SNPP_LOGIN   id:password, required when the host is not loopback
  BIPEUR_URL          Central base URL, default http://127.0.0.1:8787
  BIPEUR_TOKEN        station token sent as Authorization: Bearer

Demonstration session — nc 127.0.0.1 4440, then type the C: lines:

${formatTranscript()}
`;

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`bipeur-snpp: ${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }

  if (!config.token) {
    process.stderr.write('bipeur-snpp: BIPEUR_TOKEN is empty — the Central will refuse every page\n');
  }

  const gateway: SnppGateway = createGateway({
    client: httpBeeperClient({ url: config.centralUrl, token: config.token }),
    credentials: config.credentials,
    defaultTtlHours: config.defaultTtlHours,
    decisionWaitSeconds: config.decisionWaitSeconds,
    idleTimeoutMs: config.idleTimeoutMs,
    log: (line) => process.stderr.write(`${line}\n`),
  });

  const { host, port } = await gateway.listen(config.host, config.port);
  process.stdout.write(`bipeur-snpp: SNPP (V3) listening on ${host}:${port}\n`);
  process.stdout.write(`bipeur-snpp: pages go to ${config.centralUrl}\n`);
  if (config.credentials) process.stdout.write('bipeur-snpp: LOGIn is required\n');

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(`bipeur-snpp: ${signal} received, closing\n`);
    void gateway.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

void main().catch((error: unknown) => {
  process.stderr.write(`bipeur-snpp: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
