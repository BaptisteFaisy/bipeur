/**
 * BIP-N-06 — no sound, ever, by default. The intent to beep is proven by the
 * `beep.requested` audit event; this test reads the source, so a future commit
 * that adds an audio API fails here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { call, startBench } from './helpers.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const FORBIDDEN = [/new Audio\b/, /AudioContext/, /HTMLAudioElement/, /\.play\(/, /navigator\.vibrate/];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('BIP-N-06 — the Central never triggers a sound', () => {
  it('contains no audio API anywhere in its sources', () => {
    const files = sources(SRC);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) expect(pattern.test(text), `${file} matches ${pattern}`).toBe(false);
    }
  });

  it('proves the intent to beep with an audit event instead', async () => {
    const bench = await startBench();
    await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
    });
    const beeps = bench.central.audit.list({ type: 'beep.requested' });
    expect(beeps).toHaveLength(1);
    expect(beeps[0]!.data).toMatchObject({ reminder: 0 });
    await bench.close();
  });
});
