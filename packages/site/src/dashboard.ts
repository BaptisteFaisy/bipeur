/**
 * The dashboard, without leaving the site: the real dashboard runs on the
 * Central (it needs the API, the store and the station token), so the site
 * frames it — full height, under the same header as the rest — and the
 * visitor's address bar never moves. A Central URL that is not http(s) falls
 * back to the same origin; it is never interpolated as given.
 */
import { dashboardUrl, type SiteConfig } from './config.js';
import { escapeHtml, renderPage } from './html.js';

export function renderDashboard(config: SiteConfig): string {
  const body = `    <header class="docs-header wrap">
      <a class="home" href="../">&larr; Home</a>
      <nav aria-label="Site">
        <ul class="docs-nav">
          <li><a href="../app/">Pager</a></li>
          <li><a href="../app/?screen=demo">Demo</a></li>
          <li><a href="../docs/">Docs</a></li>
        </ul>
      </nav>
    </header>
    <main class="dashboard-main">
      <iframe
        class="dashboard-frame"
        src="${escapeHtml(dashboardUrl(config))}"
        title="Beeper Central dashboard"
      ></iframe>
      <p class="dashboard-note wrap">The dashboard asks for a station token —
      the Central prints it once at boot. It runs on the Central&rsquo;s own
      origin; this site stores nothing. Frame blocked by the browser?
      <a href="${escapeHtml(dashboardUrl(config))}" rel="noopener">Open it in a new tab</a>.</p>
    </main>`;
  return renderPage({
    title: 'Dashboard — Beeper',
    description:
      'Live stations, queue with hold reasons, audit, metrics and rules bench — framed from the Central, without leaving the site.',
    cssHref: '../site.css',
    iconHref: '../icon.svg',
    body,
  });
}
