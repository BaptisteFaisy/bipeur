/**
 * The public sandbox page (BIP-F-49): the ten real answers, the real links, and
 * no JavaScript unless a Central was configured at build time.
 */
import { describe, expect, it } from 'vitest';
import { readEnvConfig } from '../src/config.js';
import { escapeHtml } from '../src/html.js';
import { renderLanding } from '../src/landing.js';
import { renderSandbox } from '../src/sandbox.js';
import { SANDBOX_ROWS } from '../src/sandbox-board.js';

const STATIC = readEnvConfig({ SITE_BASE: '/bipeur/', CENTRAL_URL: '' });
const LIVE = readEnvConfig({ SITE_BASE: '/bipeur/', CENTRAL_URL: 'https://central.example' });

const page = renderSandbox(STATIC);
const live = renderSandbox(LIVE);

describe('renderSandbox', () => {
  it('explains the product in one minute', () => {
    expect(page).toContain('Beeper &mdash; the sandbox');
    expect(page).toContain('CODE STATION VERB subject #hhhh');
    expect(page).toContain('ECDSA');
    expect(page).toContain('Try to make us approve');
    expect(page).toContain('one line. one code. one tap.');
  });

  it('renders all ten attempts with their real composed line', () => {
    expect(SANDBOX_ROWS).toHaveLength(10);
    for (const row of SANDBOX_ROWS) {
      // The line is escaped on the way in (`main>origin` becomes
      // `main&gt;origin`): compare with what the page actually carries.
      const line = escapeHtml(row.line);
      expect(page, `attempt ${row.id}`).toContain(escapeHtml(row.input));
      expect(page, `attempt ${row.id}`).toContain(line);
      expect(page, `attempt ${row.id}`).toContain(row.matched_by);
      expect(page, `attempt ${row.id}`).toContain(row.fingerprint.slice(0, 8));
      expect(page, `attempt ${row.id}`).toContain(`attempt-${row.id}`);
      expect(page, `attempt ${row.id}`).toContain(`verdict-${row.outcome}`);
    }
  });

  it('says what each outcome means, and counts the score from the rows', () => {
    const blocked = SANDBOX_ROWS.filter((row) => row.outcome === 'blocked').length;
    const paged = SANDBOX_ROWS.filter((row) => row.outcome === 'paged').length;
    expect(blocked).toBeGreaterThan(0);
    expect(paged).toBeGreaterThan(0);
    expect(page).toContain(`${blocked} were`);
    expect(page).toContain(`${paged} rang a pager`);
    expect(page).not.toContain('NO PAGE AT ALL — the guard failed, the command went through unseen');
  });

  it('promises isolation and states where the lines come from', () => {
    expect(page).toContain('No page is created here');
    expect(page).toContain('packages/central/src/sandbox.ts');
    expect(page).toContain('.bipeur/rules.yaml');
    expect(page).toContain('/v1/sandbox/probe');
  });

  it('carries the links back home, to the docs and to the pager', () => {
    expect(page).toContain('href="../"');
    expect(page).toContain('href="../docs/"');
    expect(page).toContain('href="../app/"');
    expect(page).toContain('href="../site.css"');
    expect(page).toContain('href="../docs/sandbox.html"');
  });

  it('is static: no script at all when no Central is configured', () => {
    expect(page).not.toContain('<script');
    expect(page).toContain('no Central configured for this build');
    expect(page).toContain('<noscript>');
  });

  it('adds one dependency-free probe when a Central is configured', () => {
    expect(live).toContain('<script>');
    expect(live).toContain('data-endpoint="https://central.example/v1/sandbox/probe"');
    expect(live).toContain('fetch(out.dataset.endpoint');
    // Minimal and self-contained: no library, no remote script, no innerHTML.
    expect(live).not.toContain('<script src');
    expect(live).not.toContain('innerHTML');
    expect(live).not.toContain('eval(');
  });

  it('keeps the honesty rule on the published rows: prose only after the facts', () => {
    // Attempt 8 declares `green` and narrates the cleanup: the agent's words
    // appear on a detail screen, labelled, and never inside the composed line.
    const eighth = SANDBOX_ROWS.find((row) => row.id === 8);
    expect(eighth?.line).not.toContain('harmless');
    expect(page).toContain('AGENT SAYS: harmless dependency cleanup');

    const blocks = page
      .split('<pre class="screens">')
      .slice(1)
      .map((block) => block.split('</pre>')[0] ?? '');
    expect(blocks).toHaveLength(SANDBOX_ROWS.length);
    for (const block of blocks) {
      const lines = block.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
      const prose = lines.findIndex((line) => line.includes('AGENT SAYS:'));
      if (prose >= 0) expect(prose).toBe(lines.length - 1);
    }
  });
});

describe('the landing points at the sandbox', () => {
  it('offers the challenge on the front page', () => {
    const landing = renderLanding(STATIC);
    expect(landing).toContain('href="sandbox/"');
    expect(landing).toContain('Jailbreak the pager');
  });
});
