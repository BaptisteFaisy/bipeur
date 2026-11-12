/** The landing: the real links, the real copy, and nothing executable. */
import { describe, expect, it } from 'vitest';
import { readEnvConfig } from '../src/config.js';
import { escapeHtml } from '../src/html.js';
import { renderLanding } from '../src/landing.js';

const CENTRAL = 'https://central.example';

const config = readEnvConfig({
  SITE_BASE: '/bipeur',
  CENTRAL_URL: CENTRAL,
});

const html = renderLanding(config);

describe('readEnvConfig', () => {
  it('normalises the base and keeps the Central as given', () => {
    expect(config.siteBase).toBe('/bipeur/');
    expect(config.centralUrl).toBe(CENTRAL);
    expect(config.pagerDist).toBe('packages/pager/dist');
    expect(config.docsDir).toBe('docs');
    expect(config.outDir).toBe('site-dist');
  });

  it('defaults to the root prefix and same-origin Central', () => {
    const defaults = readEnvConfig({});
    expect(defaults.siteBase).toBe('/');
    expect(defaults.centralUrl).toBe('');
  });
});

describe('renderLanding', () => {
  it('carries the hero', () => {
    expect(html).toContain('One line. One code. One tap.');
  });

  it('links the pager, the demo deep-link, the dashboard and the docs', () => {
    expect(html).toContain('href="app/"');
    expect(html).toContain('href="app/?screen=demo"');
    expect(html).toContain('href="dashboard/"');
    expect(html).toContain('href="docs/"');
  });

  it('keeps the dashboard on the site: no link leaves for the Central', () => {
    expect(html).not.toContain(`${CENTRAL}/dashboard`);
  });

  it('names every integration', () => {
    for (const name of ['Kiro hook', 'MCP server', 'SNPP gateway', 'Crew app', 'CLI']) {
      expect(html).toContain(name);
    }
    expect(html).toContain('page_human');
    expect(html).toContain('PreToolUse');
    expect(html).toContain('RFC 1861');
  });

  it('shows the risk table, the page line and the honesty rule', () => {
    expect(html).toContain('One tap, possible from the notification');
    expect(html).toContain('One tap inside the open pager');
    expect(html).toContain('press-and-hold');
    expect(html).toContain('310 a PUSH main&gt;origin 3 commits +120-14 #07c2');
    expect(html).toContain('honesty rule');
    expect(html).toContain('AGENT SAYS:');
  });

  it('has an install section and the GitHub footer', () => {
    expect(html).toContain('<h2>Install</h2>');
    expect(html).toContain('https://github.com/BaptisteFaisy/bipeur');
  });

  it('is a static page: no script, no webfont', () => {
    expect(html).not.toContain('<script');
    expect(html).not.toContain('@font-face');
    expect(html).toContain('href="site.css"');
  });
});

describe('escapeHtml', () => {
  it('escapes the five dangerous characters', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });
});
