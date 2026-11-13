/**
 * The landing page: static English copy in template literals, one section per
 * function, every internal link relative (the site lives under a prefix).
 * Style: the sober "Central" direction — dark #12100e, system monospace.
 */
import type { SiteConfig } from './config.js';
import { escapeHtml, renderPage } from './html.js';

const GITHUB_URL = 'https://github.com/BaptisteFaisy/bipeur';
const PAGES_ORIGIN = 'https://tradoooo.github.io';
const PAGE_LINE = '310 a PUSH main>origin 3 commits +120-14 #07c2';

export function renderLanding(config: SiteConfig): string {
  const body = [
    heroSection(),
    featuresSection(),
    integrationsSection(),
    riskSection(),
    pageLineSection(),
    installSection(),
    footerSection(),
  ].join('\n');
  return renderPage({
    title: 'Beeper — the pager is back, for your AI agents',
    description:
      'One line. One code. One tap. Your coding agents page you only when a human decision is actually required, and you approve or refuse from a pager.',
    cssHref: 'site.css',
    canonical: `${PAGES_ORIGIN}${config.siteBase}`,
    body: `    <main class="wrap">
${body}
    </main>`,
  });
}

function heroSection(): string {
  return `      <section class="hero">
        <p class="brandline">Beeper</p>
        <h1>One line. One code. One tap.</h1>
        <p class="pitch">Your coding agents page you only when a human decision is
        actually required &mdash; and you approve or refuse from a pager. SNPP level 3
        (RFC 1861), resurrected as the attention layer between agents and the human
        on call.</p>
      </section>`;
}

interface Feature {
  title: string;
  text: string;
  cta: string;
  href: string;
}

function features(): Feature[] {
  return [
    { title: 'Open the pager', text: 'The installable PWA: 4 rows × 20 columns, three keys, a risk lamp.', cta: 'Launch →', href: 'app/' },
    { title: 'Live demo', text: 'The Central simulator plays three fictional agents: an isolated space per visitor, no account, wiped after 24 h.', cta: 'Try it →', href: 'app/?screen=demo' },
    { title: 'Dashboard', text: 'Stations, queue with hold reasons, audit, metrics and the rules bench — the live Central, framed inside this site.', cta: 'Open →', href: 'dashboard/' },
    { title: 'Documentation', text: 'Architecture, deployment, SNPP, threat model, operations.', cta: 'Read →', href: 'docs/' },
  ];
}

function featuresSection(): string {
  const cards = features()
    .map((feature) => cardHtml(feature.title, feature.text, feature.cta, feature.href))
    .join('\n');
  return `      <section>
        <h2>Start here</h2>
        <ul class="grid">
${cards}
        </ul>
      </section>`;
}

interface Integration {
  name: string;
  text: string;
}

const INTEGRATIONS: readonly Integration[] = [
  { name: 'Kiro hook', text: '<code>bip-hook</code> plugs into <code>PreToolUse</code>: it pages the human, blocks the tool, resumes on approval (exit <code>0</code>) or refuses with a reason (exit <code>2</code>).' },
  { name: 'MCP server', text: '<code>page_human</code>, <code>page_wait</code>, <code>page_cancel</code> — any MCP client can ask the human, without changing the agent.' },
  { name: 'SNPP gateway', text: 'A real RFC 1861 two-way transaction over TCP: <code>2WAY</code>, <code>MESSage</code>, <code>MCREsponse</code>, <code>ACKRead</code>, <code>EXPTag</code>, <code>KTAG</code>.' },
  { name: 'Crew app', text: 'Relays Kiro Crew approval events to the pager and resolves them from a signed decision.' },
  { name: 'CLI', text: '<code>bip</code>: ask a human from a shell script. Exit 0 = yes, 1 = no, 3 = expired.' },
  { name: 'Pager emulator', text: '<code>bip-pager</code> — the unit side of RFC 1861: it registers with <code>UNIT &lt;capcode&gt;</code>, receives the page over TCP, shows it on a 4 × 20 LCD in the terminal and answers <code>MCR 0001</code>.' },
];

function integrationsSection(): string {
  const cards = INTEGRATIONS.map((item) => cardHtml(item.name, item.text, null, null)).join('\n');
  return `      <section>
        <h2>Integrations</h2>
        <ul class="grid">
${cards}
        </ul>
      </section>`;
}

/** One grid card; `text` is trusted static copy, `href` is escaped. */
function cardHtml(title: string, text: string, cta: string | null, href: string | null): string {
  const link =
    cta && href
      ? `\n          <a class="cta" href="${escapeHtml(href)}">${escapeHtml(cta)}</a>`
      : '';
  return `        <li class="card">
          <h3>${title}</h3>
          <p>${text}</p>${link}
        </li>`;
}

const RISKS: readonly [string, string, string, string][] = [
  ['green', 'Green', 'Local and reversible', 'One tap, possible from the notification'],
  ['amber', 'Amber', 'Touches the outside world or a wide scope', 'One tap inside the open pager'],
  ['red', 'Red', 'Irreversible or destructive', 'Pager open + one second press-and-hold'],
];

function riskSection(): string {
  const rows = RISKS.map(
    ([shape, name, scope, gesture]) => `          <tr>
            <td><span class="lamp lamp-${shape}" aria-hidden="true"></span>${name}</td>
            <td>${scope}</td>
            <td>${gesture}</td>
          </tr>`,
  ).join('\n');
  return `      <section>
        <h2>Three risk levels, three gestures</h2>
        <table>
          <thead><tr><th>Lamp</th><th>Scope</th><th>Gesture</th></tr></thead>
          <tbody>
${rows}
          </tbody>
        </table>
        <p class="pitch">The level is computed by rules, never declared by the agent; a source can raise it, never lower it.</p>
      </section>`;
}

function pageLineSection(): string {
  return `      <section>
        <h2>The page line</h2>
        <pre class="line"><code>${escapeHtml(PAGE_LINE)}</code></pre>
        <p class="pitch"><code>CODE STATION VERB subject #hhhh</code> — 80 printable
        ASCII characters maximum, where <code>#hhhh</code> is the first half-byte of the
        SHA-256 of the exact payload.</p>
        <p class="note"><strong>The honesty rule.</strong> The line and the detail
        screens are composed by the Central from the payload alone — the command, the
        path, the branch, the diff stats. The agent&rsquo;s own prose appears only on
        the last screen, labelled <code>AGENT SAYS:</code> — you decide on the fact,
        never on the narrative.</p>
      </section>`;
}

function installSection(): string {
  return `      <section>
        <h2>Install</h2>
        <p class="pitch">The pager is an installable PWA — no store, no account. Open
        <a href="app/">the pager</a> in your browser and use its
        <em>Install</em> / <em>Add to home screen</em> action: it then runs
        standalone, offline-first, with push notifications and an icon of its own.
        Nothing leaves the browser except the signed decisions.</p>
      </section>`;
}

function footerSection(): string {
  return `      <footer>
        <a href="${escapeHtml(GITHUB_URL)}">github.com/BaptisteFaisy/bipeur</a> — MIT.
        One line. One code. One tap.
      </footer>`;
}
