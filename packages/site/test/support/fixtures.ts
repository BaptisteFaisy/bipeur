/**
 * Temporary fixtures for the site tests: a fake pager dist, a fake docs
 * directory, a throwaway OUT_DIR. Nothing is written outside `os.tmpdir()`,
 * nothing touches the network.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `bipeur-site-${prefix}-`));
}

/** A pager dist shaped like the real vite output, minus the bytes. */
export function makePagerDist(root: string): string {
  const dist = join(root, 'pager-dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>pager</title>\n');
  writeFileSync(join(dist, 'sw.js'), '// service worker\n');
  writeFileSync(join(dist, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  writeFileSync(join(dist, 'assets', 'app.js'), 'export {};\n');
  return dist;
}

export function makeDocsDir(root: string): string {
  const docs = join(root, 'docs');
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(docs, 'Guide.md'), '# User guide\n\nInstall **everything**.\n');
  writeFileSync(join(docs, 'notes.md'), 'Plain notes without a heading.\n');
  writeFileSync(join(docs, 'ignored.txt'), 'not markdown\n');
  return docs;
}
