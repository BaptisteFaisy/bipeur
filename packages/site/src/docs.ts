/**
 * The docs renderer: every `*.md` of DOCS_DIR becomes `docs/<slug>.html`
 * (slug = file name without extension, lowercased), plus `docs/index.html`.
 * One common template — "← Home", a nav of all the docs, the rendered
 * markdown — and no script anywhere.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import { escapeHtml, renderPage } from './html.js';

export interface DocEntry {
  slug: string;
  title: string;
  markdown: string;
}

export function collectDocs(docsDir: string): DocEntry[] {
  const files = readdirSync(docsDir)
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .sort((a, b) => a.localeCompare(b));
  return files.map((name) => {
    const markdown = readFileSync(join(docsDir, name), 'utf8');
    const slug = slugOf(name);
    return { slug, title: titleOf(markdown, slug), markdown };
  });
}

/** `ART-DIRECTION.md` → `art-direction`. */
export function slugOf(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').toLowerCase();
}

/** The first level-1 heading, or the slug when the document has none. */
export function titleOf(markdown: string, fallback: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
  return heading && heading.length > 0 ? heading : fallback;
}

export function markdownToHtml(markdown: string): string {
  const rendered = marked.parse(markdown, { async: false });
  return typeof rendered === 'string' ? rendered : '';
}

export function renderDocPage(entry: DocEntry, all: readonly DocEntry[]): string {
  const body = `${docsHeader(all, entry.slug)}
    <article class="markdown">
${markdownToHtml(entry.markdown)}
    </article>`;
  return wrapDocsPage(`${entry.title} — Beeper`, body);
}

export function renderDocsIndex(all: readonly DocEntry[]): string {
  const items = all
    .map(
      (entry) =>
        `        <li class="card"><h3><a href="${escapeHtml(entry.slug)}.html">${escapeHtml(entry.title)}</a></h3></li>`,
    )
    .join('\n');
  const body = `${docsHeader(all, null)}
    <article class="markdown">
      <h1>Documentation</h1>
      <ul class="grid">
${items}
      </ul>
    </article>`;
  return wrapDocsPage('Documentation — Beeper', body);
}

/** Header shared by every docs page: home link and the nav of all the docs. */
function docsHeader(all: readonly DocEntry[], currentSlug: string | null): string {
  const links = all
    .map((entry) => {
      const aria = entry.slug === currentSlug ? ' aria-current="page"' : '';
      return `          <li><a href="${escapeHtml(entry.slug)}.html"${aria}>${escapeHtml(entry.title)}</a></li>`;
    })
    .join('\n');
  return `    <header class="docs-header wrap">
      <a class="home" href="../">&larr; Home</a>
      <nav aria-label="Documentation">
        <ul class="docs-nav">
${links}
        </ul>
      </nav>
    </header>
    <main class="wrap">`;
}

function wrapDocsPage(title: string, body: string): string {
  return renderPage({
    title,
    description: 'Beeper documentation — architecture, deployment, protocols, operations.',
    cssHref: '../site.css',
    iconHref: '../icon.svg',
    body: `${body}
    </main>`,
  });
}
