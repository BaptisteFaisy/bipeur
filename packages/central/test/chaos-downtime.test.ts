/**
 * Chaos bench, part 1 — downtime (threat 7 of A.10) and a sick store.
 *
 * The Central must fail closed: a hook facing a dead Central refuses with
 * code 2, a store that cannot be trusted refuses to serve, and nothing ever
 * degrades into an approval. Everything runs on loopback, injected clocks,
 * temporary files — no external network, no sound.
 */
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { runHook } from '../../hook/src/run-hook.js';
import { createServer as createCentral } from '../src/server.js';
import type { Bench } from './helpers.js';
import { REPO_RULES, call, startBench } from './helpers.js';

let bench: Bench | null = null;

afterEach(async () => {
  if (bench) {
    await bench.close();
    bench = null;
  }
});

/** A loopback port nothing listens on: the kernel said it was free. */
async function deadPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function hookEvent(command: string): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'shell',
    session_id: 'chaos',
    cwd: '/tmp',
    tool_input: { command },
  });
}

function hookOptions(url: string): Parameters<typeof runHook>[1] {
  return {
    rulesPath: REPO_RULES,
    url,
    token: 'chaos-token',
    station: 'chaos',
    ttlMs: 2000,
    timeoutMs: 4000,
    waitSeconds: 1,
    dryRun: false,
  };
}

describe('threat 7 — the Central is down', () => {
  it('bip-hook refuses (exit 2) when nothing listens', async () => {
    const port = await deadPort();
    const result = await runHook(hookEvent('git push origin main'), hookOptions(`http://127.0.0.1:${port}`));
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/no page created/i); // the page itself failed: not a local deny
  });

  it('bip-hook refuses when the Central dies during the long poll', async () => {
    bench = await startBench();
    const { url } = await bench.central.listen();
    const waiting = runHook(hookEvent('git push origin main'), {
      ...hookOptions(url),
      token: bench.stationToken,
      ttlMs: 20_000,
      timeoutMs: 15_000,
      waitSeconds: 5,
    });
    // Wait until the page exists — the hook is then inside the long poll —
    // and only pull the plug at that point.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const events = await call(bench.central, 'GET', '/v1/audit?type=page.created', bench.stationToken);
      if ((events.body.events as unknown[]).length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await bench.central.close();
    const result = await waiting;
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/no decision|no page created/i);
  });

  it('a restart never resurrects a decision into a second acceptance', async () => {
    bench = await startBench();
    const page = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'restart during decision?',
      dedupe_key: 'chaos-restart-1',
    });
    expect(page.status).toBe(201);
    const before = await call(bench.central, 'GET', '/v1/audit?type=page.decided', bench.stationToken);
    await bench.central.close();
    // The process is gone mid-flight; SQLite is synchronous, so whatever the
    // store committed is exactly what the next boot must see — no more.
    bench.central = await createCentral(bench.config);
    const after = await call(bench.central, 'GET', '/v1/audit?type=page.decided', bench.stationToken);
    expect(after.body.events.length).toBe(before.body.events.length);
    const state = await call(bench.central, 'GET', `/v1/pages/${page.body.page_id}`, bench.stationToken);
    expect(['queued', 'delivered', 'read']).toContain(state.body.state);
  });
});

describe('a sick store fails closed', () => {
  it('refuses to boot on a corrupted SQLite file', async () => {
    bench = await startBench();
    const dbPath = bench.config.dbPath;
    await bench.central.close();
    writeFileSync(dbPath, 'this is not a database, it is garbage');
    await expect(createCentral(bench.config)).rejects.toThrow();
  });

  it('never serves a false state on a truncated SQLite file', async () => {
    bench = await startBench();
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'page before truncation?',
      dedupe_key: 'chaos-trunc-1',
    });
    expect(created.status).toBe(201);
    const dbPath = bench.config.dbPath;
    await bench.central.close();
    const bytes = readFileSync(dbPath);
    writeFileSync(dbPath, bytes.subarray(0, Math.floor(bytes.length / 2)));
    // Fail-closed means: either the boot is refused, or a boot on the wreck
    // cannot create pages. Serving a phantom 201 would be the failure.
    let central = null;
    let bootRefused = false;
    try {
      central = await createCentral(bench.config);
    } catch {
      bootRefused = true;
    }
    if (central) {
      bench.central = central;
      const retry = await call(central, 'POST', '/v1/pages', bench.stationToken, {
        kind: 'question',
        question: 'page after truncation?',
        dedupe_key: 'chaos-trunc-2',
      });
      expect(retry.status).toBeGreaterThanOrEqual(500);
    }
    expect(bootRefused || central !== null).toBe(true);
  });

  it('serves no false state when writes die (read-only file, disk full stand-in)', async () => {
    bench = await startBench();
    const dbPath = bench.config.dbPath;
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'page before the disk dies?',
      dedupe_key: 'chaos-ro-1',
    });
    expect(created.status).toBe(201);
    await bench.central.close();
    chmodSync(dbPath, 0o444);
    let central = null;
    let bootRefused = false;
    try {
      central = await createCentral(bench.config);
    } catch {
      bootRefused = true;
    }
    try {
      if (central) {
        bench.central = central;
        const retry = await call(central, 'POST', '/v1/pages', bench.stationToken, {
          kind: 'question',
          question: 'page while read-only?',
          dedupe_key: 'chaos-ro-2',
        });
        // A write on a read-only store must fail loudly: never a phantom 201.
        expect(retry.status).toBeGreaterThanOrEqual(500);
      }
    } finally {
      chmodSync(dbPath, 0o644); // afterEach closes and deletes cleanly
    }
    expect(bootRefused || central !== null).toBe(true);
  });
});
