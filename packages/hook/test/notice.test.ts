/**
 * BIP-F-25 — the end-of-turn notice. It reports, it never blocks and it never
 * fails the turn, whatever the Central does.
 */
import { describe, expect, it } from 'vitest';
import { composeNoticeLine, noticeTextFrom, runNotice } from '../src/notice.js';
import { fakeCentral, jsonResponse } from './helpers.js';

const options = (fetchImpl: Parameters<typeof runNotice>[1]['fetchImpl']) => ({
  url: 'http://central.test',
  token: 'bip_test',
  station: 'fw',
  fetchImpl,
});

describe('BIP-F-25 — the notice is one printable ASCII line of at most 80 characters', () => {
  it('posts a single line built from the event', async () => {
    const central = fakeCentral(() => jsonResponse({ ok: true }, 201));
    const event = JSON.stringify({ hook_event_name: 'Stop', cwd: '/repo', message: 'tests green, 3 files' });
    const result = await runNotice(event, options(central.fetchImpl));

    expect(result.code).toBe(0);
    expect(central.calls).toHaveLength(1);
    expect(central.calls[0]?.url).toBe('http://central.test/v1/notices');
    expect(central.calls[0]?.body).toEqual({ line: 'fw tests green, 3 files' });
  });

  it('truncates a long line to 80 characters and keeps it printable ASCII', () => {
    const line = composeNoticeLine(`déployé ${'x'.repeat(120)}`, 'fw');
    expect(line.length).toBeLessThanOrEqual(80);
    expect(/^[\x20-\x7e]+$/.test(line)).toBe(true);
    expect(line.startsWith('fw deploye')).toBe(true);
  });

  it('derives a line from an event without a message', () => {
    expect(noticeTextFrom(JSON.stringify({ hook_event_name: 'Stop', cwd: '/home/b/repo' }))).toBe(
      'Stop repo',
    );
    expect(noticeTextFrom('   ')).toBe('turn finished');
  });
});

describe('BIP-F-25 — a failing Central never fails the turn', () => {
  it('still exits 0 when fetch throws', async () => {
    const central = fakeCentral(() => {
      throw new TypeError('fetch failed');
    });
    const result = await runNotice('turn done', options(central.fetchImpl));
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('notice not delivered');
  });

  it('still exits 0 on an error status', async () => {
    const central = fakeCentral(() => jsonResponse({ error: 'nope' }, 500));
    const result = await runNotice('turn done', options(central.fetchImpl));
    expect(result.code).toBe(0);
  });

  it('does nothing at all when the Central is not configured', async () => {
    const central = fakeCentral(() => jsonResponse({ ok: true }));
    const result = await runNotice('turn done', { station: 'fw', fetchImpl: central.fetchImpl });
    expect(result.code).toBe(0);
    expect(central.calls).toHaveLength(0);
  });
});
