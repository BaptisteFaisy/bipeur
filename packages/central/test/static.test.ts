/**
 * BIP-N-09 — one process, one URL: the Central serves the built pager when the
 * folder exists and falls back cleanly when it does not.
 */
import { describe, expect, it } from 'vitest';
import { fallbackPage, pagerDist, servePager } from '../src/static.js';
import { startBench } from './helpers.js';

describe('BIP-N-09 — the Central serves the pager from the same URL', () => {
  it('knows where the pager build lives', () => {
    expect(pagerDist()).toContain('pager');
    expect(pagerDist().endsWith('dist/')).toBe(true);
  });

  it('never escapes the dist folder', () => {
    expect(servePager('/../../package.json')).toBeNull();
    expect(servePager('/../src/server.ts')).toBeNull();
  });

  it('answers GET / with either the pager or a readable fallback', async () => {
    const bench = await startBench();
    const response = await bench.central.app.request('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    await bench.close();
  });

  it('the fallback explains what to do', async () => {
    const html = await fallbackPage().text();
    expect(html).toContain('Beeper Central is running');
    expect(html).toContain('pnpm build');
  });

  it('answers 404 as JSON for an unknown API route', async () => {
    const bench = await startBench();
    const response = await bench.central.app.request('/v1/unknown');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'not_found' });
    await bench.close();
  });
});
