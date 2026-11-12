/**
 * The assembler: reads the environment, then writes one static tree — the
 * landing, the pager PWA copied verbatim under `app/`, the docs rendered under
 * `docs/`, the shared stylesheet and the icon. No network, no framework.
 *
 *   SITE_BASE=/bipeur/ CENTRAL_URL=https://central.example node dist/build.js
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readEnvConfig, type SiteConfig } from './config.js';
import { renderDashboard } from './dashboard.js';
import { collectDocs, renderDocPage, renderDocsIndex } from './docs.js';
import { renderLanding } from './landing.js';
import { siteCss } from './style.js';

export async function buildSite(config: SiteConfig): Promise<string[]> {
  const pagerDist = resolveExisting(config.pagerDist, 'PAGER_DIST');
  const docsDir = resolveExisting(config.docsDir, 'DOCS_DIR');
  await rm(config.outDir, { recursive: true, force: true });
  await mkdir(config.outDir, { recursive: true });

  const written: string[] = [];
  await copyApp(pagerDist, config.outDir, written);
  written.push(await write(join(config.outDir, 'site.css'), siteCss));
  written.push(
    await write(join(config.outDir, 'index.html'), renderLanding(config)),
  );
  written.push(
    await write(join(config.outDir, 'dashboard', 'index.html'), renderDashboard(config)),
  );
  written.push(...(await writeDocs(docsDir, config.outDir)));
  return written;
}

/** The pager build is copied as-is, and its icon is promoted to the root. */
async function copyApp(
  pagerDist: string,
  outDir: string,
  written: string[],
): Promise<void> {
  const appDir = join(outDir, 'app');
  await cp(pagerDist, appDir, { recursive: true });
  written.push(appDir);
  const icon = join(pagerDist, 'icon.svg');
  if (!existsSync(icon)) throw new Error(`icon.svg missing from PAGER_DIST (${pagerDist})`);
  written.push(await write(join(outDir, 'icon.svg'), await readFile(icon, 'utf8')));
}

async function writeDocs(docsDir: string, outDir: string): Promise<string[]> {
  const docs = collectDocs(docsDir);
  const docsOut = join(outDir, 'docs');
  await mkdir(docsOut, { recursive: true });
  const written = [await write(join(docsOut, 'index.html'), renderDocsIndex(docs))];
  for (const entry of docs) {
    written.push(
      await write(join(docsOut, `${entry.slug}.html`), renderDocPage(entry, docs)),
    );
  }
  return written;
}

async function write(path: string, content: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  return path;
}

function resolveExisting(path: string, name: string): string {
  if (!existsSync(path)) throw new Error(`${name} does not exist: ${path}`);
  return path;
}

async function main(): Promise<void> {
  const config = readEnvConfig();
  const written = await buildSite(config);
  console.log(`site built in ${config.outDir} (${written.length} entries)`);
  for (const path of written) console.log(`  ${path}`);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
