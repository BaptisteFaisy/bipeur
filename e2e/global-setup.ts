/**
 * The launcher writes the descriptor of the Central it started (address,
 * station token, database). The tests read it here, so no test ever guesses
 * an address or a token.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { portFor, runtimeDir } from './helpers/ports.js';

interface Descriptor {
  url: string;
  port: number;
  token: string;
  dbPath: string;
}

export default function globalSetup(): void {
  const port = portFor('sharedCentral');
  const file = resolve(runtimeDir(), `central-${port}.json`);
  if (!existsSync(file)) {
    throw new Error(`the Central descriptor is missing: ${file}`);
  }
  const descriptor = JSON.parse(readFileSync(file, 'utf8')) as Descriptor;
  process.env.BIPEUR_E2E_URL = descriptor.url;
  process.env.BIPEUR_E2E_TOKEN = descriptor.token;
}
