/**
 * BIP-F-29 — the CLI must speak the Central's real dialect.
 *
 * Found by integration testing on 2026-11-11: `bip ask` failed against a live
 * Central with "unexpected page shape", because the Central answers `page_id`
 * (A.9) while the client only accepted `id`, and the test double answered `id`
 * too — a mock that hides a contract drift. Both shapes are now accepted and
 * the double mirrors the server.
 */
import { describe, expect, it } from 'vitest';
import { createCentralClient } from '../src/api.js';
import { CliError } from '../src/errors.js';

const BASE = { baseUrl: 'http://127.0.0.1:8799', token: 'tok-int' };

const REQUEST = {
  kind: 'question' as const,
  question: 'Deploy now?',
  options: [
    { code: 'A', label: 'yes' },
    { code: 'B', label: 'no' },
  ],
};

function clientAnswering(body: unknown, status = 200) {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  return createCentralClient({ ...BASE, fetchImpl });
}

describe('BIP-F-29 — page answer shape', () => {
  it('reads the id from page_id, the field the real Central sends', async () => {
    const client = clientAnswering({
      page_id: 'pg_01',
      line: '510 crew PICK Deploy now? #a3f9',
      expires_at: 1_900_000_000_000,
    });
    const page = await client.createPage(REQUEST);
    expect(page.id).toBe('pg_01');
    expect(page.line).toBe('510 crew PICK Deploy now? #a3f9');
    expect(page.expiresAt).toBe(1_900_000_000_000);
  });

  it('still reads the id from id, and from a nested page object', async () => {
    const legacy = clientAnswering({ id: 'pg_02', line: '510 crew PICK Deploy now? #a3f9' });
    expect((await legacy.createPage(REQUEST)).id).toBe('pg_02');

    const nested = clientAnswering({
      page: { page_id: 'pg_03', line: '510 crew PICK Deploy now? #a3f9' },
    });
    expect((await nested.createPage(REQUEST)).id).toBe('pg_03');
  });

  it('refuses an answer with no id at all, and says so as an invalid shape', async () => {
    const client = clientAnswering({ line: '510 crew PICK Deploy now? #a3f9' });
    await expect(client.createPage(REQUEST)).rejects.toMatchObject({ kind: 'invalid' });
    await expect(client.createPage(REQUEST)).rejects.toBeInstanceOf(CliError);
  });

  it('never turns a network failure or a 5xx into a decision', async () => {
    const broken = createCentralClient({
      ...BASE,
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    await expect(broken.createPage(REQUEST)).rejects.toMatchObject({ kind: 'network' });

    const failing = clientAnswering({ error: 'boom' }, 503);
    await expect(failing.createPage(REQUEST)).rejects.toMatchObject({ kind: 'status' });
  });
});
