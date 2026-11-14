/**
 * The public sandbox (BIP-F-49): one minute to understand Beeper, then ten
 * attempts at making it approve something it should not — each one answered by
 * the real simulator, with the real composed line.
 *
 * Static on purpose. The ten rows are baked in at build time from
 * `packages/site/src/sandbox-board.ts`, a generated artifact a test keeps in
 * step with the Central's simulator, so the page needs no network to make its
 * claim. The only interactive part — typing your own command — is ~20 lines of
 * dependency-free JavaScript, emitted only when a Central is configured, and
 * the page says so out loud when it is not.
 */
import type { SiteConfig } from './config.js';
import { escapeHtml, renderPage } from './html.js';
import { SANDBOX_RULES, SANDBOX_ROWS, type SandboxRow } from './sandbox-board.js';

const OUTCOME_TEXT: Record<SandboxRow['outcome'], string> = {
  blocked: 'refused by a rule — no page, no tap, no human asked',
  paged: 'a page rings — the line below is what a human would read and sign',
  silent: 'NO PAGE AT ALL — the guard failed, the command went through unseen',
};

export function renderSandbox(config: SiteConfig): string {
  const body = [
    sandboxHeader(),
    oneMinuteSection(),
    scoreSection(SANDBOX_ROWS),
    attemptsSection(SANDBOX_ROWS),
    probeSection(config),
    provenanceSection(),
    sandboxFooter(),
  ].join('\n');
  return renderPage({
    title: 'Jailbreak the pager — the Beeper sandbox',
    description:
      'One minute on what Beeper is, then ten attempts at making it approve rm -rf / — each answered by the real simulator, with the real composed line.',
    cssHref: '../site.css',
    iconHref: '../icon.svg',
    body: `    <main class="wrap">
${body}
    </main>`,
  });
}

function sandboxHeader(): string {
  return `      <header class="docs-header">
        <a class="home" href="../">&larr; Home</a>
        <nav aria-label="Sandbox">
          <ul class="docs-nav">
            <li><a href="../">Landing</a></li>
            <li><a href="../docs/">Docs</a></li>
            <li><a href="../app/">Pager</a></li>
          </ul>
        </nav>
      </header>`;
}

/** The fifteen-second pitch, then the game. */
function oneMinuteSection(): string {
  return `      <section class="hero">
        <p class="brandline">Beeper &mdash; the sandbox</p>
        <h1>Try to make us approve <code>rm -rf /</code>.</h1>
        <p class="pitch">An agent that needs a human decision emits a <strong>page</strong>.
        The Central composes one line of at most 80 characters &mdash;
        <code>CODE STATION VERB subject #hhhh</code> &mdash; <em>from the facts alone</em>:
        the command, the path, the branch, the diff. A pager signs the answer with an
        ECDSA key that never leaves the browser, and the signature is bound to that exact
        line, so an approval can never be replayed on another command.</p>
        <ul class="grid">
          <li class="card"><h3>The line</h3><p>80 printable characters. What the human
          reads is what the agent is about to do, never what the agent says about it.</p></li>
          <li class="card"><h3>The rules</h3><p>Green, amber, red — computed by a rules
          file, never declared by the agent. A source may raise its own level, never
          lower it.</p></li>
          <li class="card"><h3>The signature</h3><p>One tap signs the fingerprint of the
          page with a non-extractible key. Wrong page, wrong payload, wrong device: the
          Central refuses.</p></li>
        </ul>
        <p class="pitch"><strong>The game.</strong> Below are ten ways people try to get
        something approved that should not be. Every answer is the real output of the real
        simulator, not a mock-up.</p>
      </section>`;
}

/** The score, counted from the rows themselves — never written by hand. */
function scoreSection(rows: readonly SandboxRow[]): string {
  const counted = (outcome: SandboxRow['outcome']): number =>
    rows.filter((row) => row.outcome === outcome).length;
  const silent = counted('silent');
  const verdict = silent === 0
    ? `None of the ${rows.length} attempts reached the agent unseen: ${counted('blocked')} were
        stopped by a rule before any page existed, and ${counted('paged')} rang a pager, where a
        human had to read the line and sign it.`
    : `${silent} of the ${rows.length} attempts got through without a page. This page says so
        plainly, because a sandbox that hid a failure would be advertising, not testing.`;
  return `      <section>
        <h2>Score</h2>
        <p class="pitch">${verdict}</p>
        <p class="note"><strong>No page is created here.</strong> The sandbox evaluates the
        rules and composes the line; it never writes to the store, never enters the audit
        log, never spends attention budget and never blocks an agent. It is isolated by
        construction, not by promise.</p>
      </section>`;
}

function attemptsSection(rows: readonly SandboxRow[]): string {
  const items = rows.map(attemptHtml).join('\n');
  return `      <section>
        <h2>The ten attempts</h2>
        <ol class="attempts">
${items}
        </ol>
      </section>`;
}

function attemptHtml(row: SandboxRow): string {
  const screens = row.detail.map(escapeHtml).join('\n');
  return `          <li class="card attempt" data-testid="attempt-${row.id}">
            <h3>${row.id} &middot; ${escapeHtml(row.name)}</h3>
            <p class="typed"><code>${escapeHtml(row.input)}</code></p>
            <p class="muted">${escapeHtml(row.trick)}</p>
            <pre class="line"><code>${escapeHtml(row.line)}</code></pre>
            <p class="verdict verdict-${row.outcome}">
              <span class="lamp lamp-${row.risk}" aria-hidden="true"></span>
              ${escapeHtml(OUTCOME_TEXT[row.outcome])}
            </p>
            <p class="muted">code <code>${row.code}</code> &middot; verb
              <code>${escapeHtml(row.verb)}</code> &middot; rule
              <code>${escapeHtml(row.matched_by)}</code> &middot; fingerprint
              <code>${escapeHtml(row.fingerprint.slice(0, 8))}</code>${row.truncated ? ' &middot; <em>line cut, full text below</em>' : ''}</p>
            <p class="guard">${escapeHtml(row.guard)}</p>
            <details>
              <summary>What the pager shows</summary>
              <pre class="screens">${screens}</pre>
            </details>
          </li>`;
}

/** Live probe: only when a Central is configured, and only ever a simulation. */
function probeSection(config: SiteConfig): string {
  const central = /^https?:\/\//i.test(config.centralUrl) ? config.centralUrl : '';
  const endpoint = `${central}/v1/sandbox/probe`;
  const script = central
    ? `\n<script>
  (function () {
    var out = document.getElementById('probe-out');
    document.getElementById('probe-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var command = document.getElementById('probe-input').value;
      out.textContent = 'thinking...';
      fetch(out.dataset.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: command })
      }).then(function (r) { return r.json(); }).then(function (v) {
        out.textContent = v.line
          ? v.line + '\\n' + v.outcome + ' - code ' + v.code + ' - rule ' + v.matched_by
          : (v.error || 'no answer');
      }).catch(function () { out.textContent = 'the Central did not answer'; });
    });
  })();
</script>`
    : '';
  return `      <section>
        <h2>Your own attempt</h2>
        <p class="pitch">Type anything. The simulator answers with the line a human would
        have been shown — and nothing else happens: no page, no agent blocked.</p>
        <form id="probe-form" data-testid="probe-form">
          <label for="probe-input">Command</label>
          <input id="probe-input" name="command" type="text" maxlength="500"
            autocomplete="off" spellcheck="false" placeholder="rm -rf / --no-preserve-root">
          <button type="submit">Simulate</button>
        </form>
        <pre id="probe-out" data-testid="probe-out" data-endpoint="${escapeHtml(endpoint)}"
          class="line">${central ? 'the answer appears here' : 'no Central configured for this build — the ten attempts above are the real output'}</pre>
        <noscript><p class="muted">Without JavaScript this page still shows the ten real
        answers above; a live probe needs the Central, or the rules bench on its
        dashboard.</p></noscript>${script}
      </section>`;
}

function provenanceSection(): string {
  return `      <section>
        <h2>Where these lines come from</h2>
        <p class="pitch">Every row is produced by <code>packages/central/src/sandbox.ts</code>
        against the shipped rules file <code>${escapeHtml(SANDBOX_RULES)}</code> — the same
        <code>composeRequest()</code> a real page goes through. The result is committed as a
        generated artifact, and a test re-runs the simulator on every commit and fails if the
        published rows stop matching, so nothing on this page is hand-written after the fact.
        The same board is on the wire: <code>GET /v1/sandbox/board</code>, and
        <code>POST /v1/sandbox/probe</code> answers your own command.</p>
      </section>`;
}

function sandboxFooter(): string {
  return `      <footer>
        <a href="../">Beeper</a> — one line. one code. one tap.
        Read how it works in <a href="../docs/">the docs</a>, sandbox details in
        <a href="../docs/sandbox.html">SANDBOX.md</a>.
      </footer>`;
}
