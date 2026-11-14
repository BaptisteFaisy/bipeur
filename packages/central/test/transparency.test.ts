/**
 * BIP-F-45 — the transparency surface of the Central.
 *
 * The journal is append-only *inside* this SQLite file, with a trigger that
 * refuses UPDATE. That stops accidents; it does not stop whoever holds root.
 * Folding the log into a Merkle root and publishing it outside turns the journal
 * into something an outsider can check without access to the database — and can
 * catch being lied to.
 *
 * The route side is what this file pins: the root is served, a proof is served
 * for a real event and 404 for an invented one, the checkpoint is authenticated
 * and appends to the log it commits to.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyMerkleProof } from '@bipeur/core';
import { sha256Hex } from '@bipeur/core/node';
import { afterEach, describe, expect, it } from 'vitest';
import { call, startBench, tempDir, type Bench } from './helpers.js';

let bench: Bench | null = null;
let dir = '';

afterEach(async () => {
  if (bench) await bench.close();
  bench = null;
});

describe('the root and the proof', () => {
  it('serves a root over the journal it just wrote', async () => {
    bench = await startBench();
    const root = await call(bench.central, 'GET', '/v1/transparency/root', bench.stationToken);
    expect(root.status).toBe(200);
    expect(root.body.algorithm).toBe('bipeur-merkle-v1');
    // `central.started` is appended on boot, so the log is never empty.
    expect(root.body.events).toBeGreaterThanOrEqual(1);
    expect(root.body.last_id).toBeGreaterThan(0);
    expect(String(root.body.root)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for the same journal, and moves when an event is appended', async () => {
    bench = await startBench();
    const first = await call(bench.central, 'GET', '/v1/transparency/root', bench.stationToken);
    const again = await call(bench.central, 'GET', '/v1/transparency/root', bench.stationToken);
    expect(first.body.root).toBe(again.body.root);

    await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'diff or no diff?',
    });
    const after = await call(bench.central, 'GET', '/v1/transparency/root', bench.stationToken);
    expect(after.body.root).not.toBe(first.body.root);
    expect(after.body.events).toBeGreaterThan(first.body.events);
  });

  it('proves an event belongs to the published root', async () => {
    bench = await startBench();
    const root = await call(bench.central, 'GET', '/v1/transparency/root', bench.stationToken);
    const proof = await call(
      bench.central,
      'GET',
      `/v1/transparency/proof?event_id=${root.body.last_id}`,
      bench.stationToken,
    );
    expect(proof.status).toBe(200);
    expect(proof.body.root).toBe(root.body.root);
    expect(proof.body.proof.total).toBe(root.body.events);
    expect(verifyMerkleProof(proof.body.proof, root.body.root, sha256Hex)).toBe(true);
  });

  it('refuses an event that is not in the journal', async () => {
    bench = await startBench();
    const missing = await call(bench.central, 'GET', '/v1/transparency/proof?event_id=999999', bench.stationToken);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('not_found');
  });

  it('refuses a malformed event id instead of guessing', async () => {
    bench = await startBench();
    const bad = await call(bench.central, 'GET', '/v1/transparency/proof?event_id=one', bench.stationToken);
    expect(bad.status).toBe(400);
    const none = await call(bench.central, 'GET', '/v1/transparency/proof', bench.stationToken);
    expect(none.status).toBe(400);
  });

  it('is readable without a token: a public claim needs a public check', async () => {
    bench = await startBench();
    // The bench never binds a port: the fetch is the app's own handler.
    const response = await bench.central.app.request('/v1/transparency/root');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(String(body.root)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the checkpoint', () => {
  it('appends an event and returns the root that covers it', async () => {
    bench = await startBench();
    const before = await call(bench.central, 'GET', '/v1/transparency/root', bench.stationToken);
    const made = await call(bench.central, 'POST', '/v1/transparency/checkpoint', bench.stationToken, {});
    expect(made.status).toBe(201);
    expect(made.body.events).toBeGreaterThan(before.body.events);

    const audit = await call(bench.central, 'GET', '/v1/audit?type=transparency.checkpoint', bench.stationToken);
    expect(audit.body.events.length).toBe(1);
    // The checkpoint commits to the log *before* it: the anchor can never hide
    // the fact that it was written.
    expect(audit.body.events[0].data.events).toBe(before.body.events);
  });

  it('needs a station token, unlike the reads', async () => {
    bench = await startBench();
    const anonymous = await bench.central.app.request('/v1/transparency/checkpoint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(anonymous.status).toBe(401);
  });

  it('never carries a payload, only the shape of the log (BIP-N-03)', async () => {
    bench = await startBench();
    await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'rm -rf /secret/path',
    });
    await call(bench.central, 'POST', '/v1/transparency/checkpoint', bench.stationToken, {});
    const audit = await call(bench.central, 'GET', '/v1/audit', bench.stationToken);
    const dumped = JSON.stringify(audit.body.events);
    expect(dumped).not.toContain('rm -rf');
    expect(dumped).not.toContain('secret');
  });
});

describe('the anchor outside the database', () => {
  it('appends one line per published root', async () => {
    dir = tempDir();
    bench = await startBench({ anchorPath: join(dir, 'anchor.txt') });
    await call(bench.central, 'POST', '/v1/transparency/checkpoint', bench.stationToken, {});
    await call(bench.central, 'POST', '/v1/transparency/checkpoint', bench.stationToken, {});
    const text = readFileSync(join(dir, 'anchor.txt'), 'utf8');
    const lines = text.trim().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const [, root, events, lastId] = line.split(' ');
      expect(root).toMatch(/^[0-9a-f]{64}$/);
      expect(Number(events)).toBeGreaterThan(0);
      expect(Number(lastId)).toBeGreaterThan(0);
    }
    // Append-only: the second line is a later journal than the first.
    expect(Number(lines[1]!.split(' ')[2])).toBeGreaterThan(Number(lines[0]!.split(' ')[2]));
  });

  it('writes nothing when no anchor path is configured', async () => {
    bench = await startBench();
    expect(bench.config.anchorPath).toBeNull();
    const made = await call(bench.central, 'POST', '/v1/transparency/checkpoint', bench.stationToken, {});
    expect(made.status).toBe(201);
  });

  it('publishes a root the sweeper can fold on its own', async () => {
    dir = tempDir();
    bench = await startBench({ anchorPath: join(dir, 'anchor.txt') });
    // A hundred events, and the checkpoint is due (CHECKPOINT_EVERY = 100).
    for (let i = 0; i < 120; i += 1) {
      bench.central.audit.append({ type: 'notice.logged', data: { n: i } });
    }
    bench.central.sweep();
    const text = readFileSync(join(dir, 'anchor.txt'), 'utf8');
    expect(text.trim().split('\n').length).toBeGreaterThanOrEqual(1);
  });
});
