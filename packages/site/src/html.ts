/**
 * The HTML shell shared by the landing and every docs page. Static on purpose:
 * no framework, no script, no webfont — the system monospace stack only
 * (docs/ART-DIRECTION.md §2). Everything user- or file-derived is escaped by
 * the callers; this module escapes what it interpolates itself.
 */
export interface PageOptions {
  title: string;
  description: string;
  /** Relative href of site.css from the page (`site.css` or `../site.css`). */
  cssHref: string;
  /** Relative href of the icon; pages under `docs/` pass `../icon.svg`. */
  iconHref?: string;
  /** Absolute canonical URL, landing only. */
  canonical?: string;
  body: string;
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

export function renderPage(options: PageOptions): string {
  const canonical = options.canonical
    ? `    <link rel="canonical" href="${escapeHtml(options.canonical)}">\n`
    : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(options.title)}</title>
    <meta name="description" content="${escapeHtml(options.description)}">
    <link rel="icon" href="${escapeHtml(options.iconHref ?? 'icon.svg')}" type="image/svg+xml">
${canonical}    <link rel="stylesheet" href="${escapeHtml(options.cssHref)}">
  </head>
  <body>
${options.body}
  </body>
</html>
`;
}
