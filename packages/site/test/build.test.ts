/** The assembler: one temporary OUT_DIR, the whole contract of the tree. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSite } from '../src/build.js';
import { readEnvConfig, type SiteConfig } from '../src/config.js';
import { makeDocsDir, makePagerDist, makeTmpDir } from './support/fixtures.js';

interface Fixture {
  root: string;
  outDir: string;
  config: SiteConfig;
}

/** A fresh world per test: temp root, fake pager dist, fake docs. */
function fixture(centralUrl = 'https://central.example'): Fixture {
  const root = makeTmpDir('build');
  const outDir = join(root, 'site-dist');
  const config = readEnvConfig({
    SITE_BASE: '/bipeur/',
    CENTRAL_URL: centralUrl,
    PAGER_DIST: makePagerDist(root),
    DOCS_DIR: makeDocsDir(root),
    OUT_DIR: outDir,
  });
  return { root, outDir, config };
}

describe('buildSite', () => {
  it('writes the whole tree, in a temporary directory only', async () => {
    const { outDir, config } = fixture();
    const written = await buildSite(config);

    expect(written.length).toBeGreaterThan(0);
    for (const path of written) expect(path.startsWith(outDir)).toBe(true);
    expect(existsSync(join(outDir, 'index.html'))).toBe(true);
    expect(existsSync(join(outDir, 'site.css'))).toBe(true);
    expect(existsSync(join(outDir, 'icon.svg'))).toBe(true);
    expect(existsSync(join(outDir, 'app', 'index.html'))).toBe(true);
    expect(existsSync(join(outDir, 'app', 'sw.js'))).toBe(true);
    expect(existsSync(join(outDir, 'app', 'assets', 'app.js'))).toBe(true);
    expect(existsSync(join(outDir, 'docs', 'index.html'))).toBe(true);
    expect(existsSync(join(outDir, 'docs', 'guide.html'))).toBe(true);
    expect(existsSync(join(outDir, 'docs', 'notes.html'))).toBe(true);
  });

  it('copies the pager build verbatim and promotes the icon', async () => {
    const { outDir, config } = fixture('');
    await buildSite(config);
    expect(readFileSync(join(outDir, 'app', 'sw.js'), 'utf8')).toBe(
      readFileSync(join(config.pagerDist, 'sw.js'), 'utf8'),
    );
    expect(readFileSync(join(outDir, 'icon.svg'), 'utf8')).toBe(
      readFileSync(join(config.pagerDist, 'icon.svg'), 'utf8'),
    );
  });

  it('renders the landing and the docs with the real links', async () => {
    const { outDir, config } = fixture();
    await buildSite(config);

    const landing = readFileSync(join(outDir, 'index.html'), 'utf8');
    expect(landing).toContain('href="app/"');
    expect(landing).toContain('href="app/?screen=demo"');
    expect(landing).toContain('href="https://central.example/dashboard"');
    expect(landing).toContain('href="docs/"');

    const doc = readFileSync(join(outDir, 'docs', 'guide.html'), 'utf8');
    expect(doc).toContain('<title>User guide — Beeper</title>');
    expect(doc).toContain('href="../"');
    expect(doc).toContain('href="../site.css"');
    expect(doc).toContain('<strong>everything</strong>');
    expect(doc).not.toContain('<script');
  });

  it('refuses to build without a pager dist', async () => {
    const { root, outDir, config } = fixture();
    await expect(
      buildSite({ ...config, pagerDist: join(root, 'absent'), outDir }),
    ).rejects.toThrow(/PAGER_DIST/);
  });
});
