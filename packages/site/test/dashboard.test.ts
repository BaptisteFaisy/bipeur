/** The dashboard page: the Central framed, the visitor stays on the site. */
import { describe, expect, it } from 'vitest';
import { dashboardUrl, readEnvConfig } from '../src/config.js';
import { renderDashboard } from '../src/dashboard.js';

describe('dashboardUrl', () => {
  it('prefixes an http(s) Central', () => {
    expect(dashboardUrl(readEnvConfig({ CENTRAL_URL: 'https://central.example' }))).toBe(
      'https://central.example/dashboard',
    );
  });

  it('falls back to the same origin when no Central is set', () => {
    expect(dashboardUrl(readEnvConfig({}))).toBe('/dashboard');
  });

  it('refuses a non-http scheme instead of interpolating it', () => {
    expect(dashboardUrl(readEnvConfig({ CENTRAL_URL: 'javascript:alert(1)' }))).toBe('/dashboard');
  });
});

describe('renderDashboard', () => {
  const html = renderDashboard(
    readEnvConfig({ SITE_BASE: '/bipeur', CENTRAL_URL: 'https://central.example' }),
  );

  it('frames the Central dashboard', () => {
    expect(html).toContain('<iframe');
    expect(html).toContain('src="https://central.example/dashboard"');
    expect(html).toContain('title="Beeper Central dashboard"');
  });

  it('keeps the visitor on the site: home, pager, demo, docs', () => {
    for (const href of ['href="../"', 'href="../app/"', 'href="../app/?screen=demo"', 'href="../docs/"']) {
      expect(html).toContain(href);
    }
  });

  it('explains the station token and stays style-consistent', () => {
    expect(html).toContain('station token');
    expect(html).toContain('href="../site.css"');
    expect(html).not.toContain('@font-face');
  });

  it('offers a new-tab fallback for browsers that block the frame', () => {
    expect(html).toContain('Open it in a new tab');
    expect(html).toContain('href="https://central.example/dashboard" rel="noopener"');
  });
});
