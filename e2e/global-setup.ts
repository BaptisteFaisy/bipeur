/**
 * The launcher writes the descriptor of the Central it started (address,
 * station token, database). The tests read it here, so no test ever guesses
 * an address or a token.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

interface Descriptor {
  url: string;
  port: number;
  token: string;
  dbPath: string;
}

export default function globalSetup(): void {
  const port = process.env.BIPEUR_E2E_PORT ?? '8799';
  const directory = process.env.BIPEUR_E2E_DB_DIR ?? resolve(HERE, '.runtime');
  const file = resolve(directory, `central-${port}.json`);
  if (!existsSync(file)) {
    throw new Error(`the Central descriptor is missing: ${file}`);
  }
  const descriptor = JSON.parse(readFileSync(file, 'utf8')) as Descriptor;
  process.env.BIPEUR_E2E_URL = descriptor.url;
  process.env.BIPEUR_E2E_TOKEN = descriptor.token;
}
