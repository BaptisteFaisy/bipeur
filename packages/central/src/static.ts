/**
 * The Central also serves the built pager (BIP-N-09: one process, one URL).
 * When `packages/pager/dist` is absent — before a build, or in a test — it
 * falls back to a small page instead of failing.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../../pager/dist/', import.meta.url));

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export function pagerDist(): string {
  return DIST;
}

/** Returns the file, or null when it is not part of the built pager. */
export function servePager(pathname: string): Response | null {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const target = resolve(DIST, relative);
  const root = resolve(DIST);
  if (target !== root && !target.startsWith(root + sep)) return null;
  if (!existsSync(target)) return null;
  if (statSync(target).isDirectory()) return null;
  return new Response(readFileSync(target), {
    headers: {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    },
  });
}

export function fallbackPage(): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Beeper Central</title>
<style>body{font-family:ui-monospace,monospace;background:#0f1412;color:#c8e6c9;padding:2rem;line-height:1.5}</style>
</head><body>
<h1>Beeper Central is running</h1>
<p>The pager build is not present. Run <code>pnpm build</code> to serve it from this same URL.</p>
<p><a href="/healthz" style="color:#8bc34a">/healthz</a></p>
</body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
