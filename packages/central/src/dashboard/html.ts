/**
 * The dashboard page (BIP-F-30). Static, dependency-free HTML: the client
 * script fetches the JSON routes and renders everything through `textContent`
 * so a page line is always data, never markup (BIP-N-08). Every block carries
 * a `data-testid` the tests assert on.
 */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Central — Beeper dashboard</title>
<link rel="stylesheet" href="/dashboard/app.css">
</head>
<body>
<header class="topbar">
  <h1>Central</h1>
  <p class="tagline">Stations, queue, history and metrics — the tool behind the pager.
    <a href="/" data-testid="pager-link">Open the pager</a></p>
  <form id="token-form" data-testid="token-form" class="token-form">
    <label for="token-input">Station token</label>
    <input id="token-input" data-testid="token-input" type="password" autocomplete="off"
      spellcheck="false" placeholder="paste a station token">
    <button type="submit" data-testid="token-save">Use token</button>
    <button type="button" id="token-clear" data-testid="token-clear">Clear</button>
  </form>
  <p class="hint">The dashboard reads the audit log, so it needs a station token.
    It is kept in <code>sessionStorage</code> only — never in the URL, never persisted.</p>
</header>
<div id="error-banner" data-testid="error-banner" role="alert" class="banner error" hidden></div>
<p id="status-banner" data-testid="status-banner" role="status" class="banner status"></p>
<main data-testid="dashboard" class="grid">

  <section aria-labelledby="metrics-h" data-testid="metrics-panel" class="card">
    <h2 id="metrics-h">Metrics <span class="sub">(A.3, computed by the Central)</span></h2>
    <p class="counter" data-testid="metrics-counter">— events, — pages</p>
    <dl class="metrics">
      <div><dt>Median decision time</dt><dd data-testid="metric-decision-median">—</dd></div>
      <div><dt>Filter rate</dt><dd data-testid="metric-filter-rate">—</dd></div>
      <div><dt>Time unblocked</dt><dd data-testid="metric-unblocked">—</dd></div>
      <div><dt>Orphan approvals</dt><dd data-testid="metric-orphans">—</dd>
        <dd class="note">guaranteed 0 by construction (BIP-F-18)</dd></div>
      <div><dt>Delivery p95</dt><dd data-testid="metric-delivery-p95">—</dd></div>
      <div><dt>Budget in use / per hour</dt><dd data-testid="metric-budget">—</dd></div>
      <div><dt>Pages delivered</dt><dd data-testid="metric-delivered">—</dd></div>
    </dl>
  </section>

  <section aria-labelledby="queue-h" data-testid="queue-panel" class="card">
    <h2 id="queue-h">Pending pages</h2>
    <ul id="queue-list" data-testid="queue-list" class="queue"></ul>
    <p id="queue-empty" data-testid="queue-empty" class="empty" hidden>No pages. Your agents are fine.</p>
  </section>

  <section aria-labelledby="sources-h" data-testid="sources-panel" class="card">
    <h2 id="sources-h">Stations</h2>
    <table class="list">
      <thead><tr><th scope="col">Alias</th><th scope="col">Kind</th>
        <th scope="col">Last activity</th><th scope="col">Pages</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
      <tbody id="sources-list" data-testid="sources-list"></tbody>
    </table>
    <p id="sources-empty" data-testid="sources-empty" class="empty" hidden>No station has paired yet.</p>
  </section>

  <section aria-labelledby="shadow-h" data-testid="shadow-panel" class="card">
    <h2 id="shadow-h">Shadow mode <span class="sub">(BIP-F-42)</span></h2>
    <p class="counter" data-testid="shadow-state">off</p>
    <dl class="metrics">
      <div><dt>Pages simulated</dt><dd data-testid="shadow-simulated">—</dd>
        <dd class="note">no human was interrupted; the agent got a simulated approval</dd></div>
      <div><dt>Would have been held</dt><dd data-testid="shadow-held">—</dd></div>
      <div><dt>Would have been denied</dt><dd data-testid="shadow-denied">—</dd></div>
      <div><dt>Really decided anyway</dt><dd data-testid="shadow-decided">—</dd></div>
    </dl>
    <form data-testid="shadow-toggle" class="bench">
      <button type="button" data-testid="shadow-on">Intercept in shadow</button>
      <button type="button" data-testid="shadow-off">Enforce</button>
    </form>
    <p class="hint">Shadow mode composes, routes and shows every page, then hands the agent a
      <strong>simulated</strong> approval and never blocks. The score is read back from the audit
      log, so a restart does not lose it.</p>
  </section>

  <section aria-labelledby="attention-h" data-testid="attention-panel" class="card">
    <h2 id="attention-h">Attention cost <span class="sub">(BIP-F-44, from the audit log)</span></h2>
    <p class="counter" data-testid="attention-total">— minutes, — pages</p>
    <dl class="metrics">
      <div><dt>Human time</dt><dd data-testid="attention-human">—</dd>
        <dd class="note">waited to read + time deciding, summed</dd></div>
      <div><dt>Denial rate</dt><dd data-testid="attention-denial">—</dd></div>
      <div><dt>Interruptions / hour</dt><dd data-testid="attention-rate">—</dd></div>
      <div><dt>Median decision</dt><dd data-testid="attention-median">—</dd></div>
      <div><dt>Read but never decided</dt><dd data-testid="attention-undecided">—</dd></div>
    </dl>
    <table class="list">
      <thead><tr><th scope="col">Station</th><th scope="col">Pages</th>
        <th scope="col">Human time</th><th scope="col">Denied</th></tr></thead>
      <tbody id="attention-list" data-testid="attention-list"></tbody>
    </table>
    <p id="attention-empty" data-testid="attention-empty" class="empty" hidden>No page in this window.</p>
    <div class="spark" data-testid="attention-spark" aria-label="Pages per hour, last 24 hours"></div>
  </section>

  <section aria-labelledby="rota-h" data-testid="rota-panel" class="card">
    <h2 id="rota-h">On-call rotas <span class="sub">(BIP-F-37)</span></h2>
    <table class="list">
      <thead><tr><th scope="col">Rota</th><th scope="col">On call</th>
        <th scope="col">Escalates after</th><th scope="col">Shifts</th></tr></thead>
      <tbody id="rota-list" data-testid="rota-list"></tbody>
    </table>
    <p id="rota-empty" data-testid="rota-empty" class="empty" hidden>No rota. Paging one person stays the default.</p>
  </section>

  <section aria-labelledby="replay-h" data-testid="replay-panel" class="card wide">
    <h2 id="replay-h">Post-mortem replay <span class="sub">(BIP-F-46)</span></h2>
    <p class="hint">Paste a page id to see <strong>exactly the screens the pager showed</strong> —
      the stored line and the stored detail screens, not a recomposition from today's rules.</p>
    <form data-testid="replay-form" class="bench">
      <label for="replay-page">Page id</label>
      <input id="replay-page" data-testid="replay-page" name="page" placeholder="pg_…" autocomplete="off" spellcheck="false">
      <button type="submit" data-testid="replay-go">Replay</button>
    </form>
    <pre id="replay-out" data-testid="replay-out" class="replay" hidden></pre>
    <p id="replay-empty" data-testid="replay-empty" class="empty">No page pasted yet.</p>
  </section>

  <section aria-labelledby="audit-h" data-testid="audit-panel" class="card wide">
    <h2 id="audit-h">Audit history</h2>
    <div class="filters">
      <label for="audit-type-filter">Type</label>
      <select id="audit-type-filter" data-testid="audit-type-filter">
        <option value="">All</option>
        <option value="page.created">page.created</option>
        <option value="page.delivered">page.delivered</option>
        <option value="page.decided">page.decided</option>
        <option value="page.expired">page.expired</option>
        <option value="page.cancelled">page.cancelled</option>
        <option value="page.escalated">page.escalated</option>
        <option value="rota.changed">rota.changed</option>
        <option value="decision.rejected">decision.rejected</option>
        <option value="beep.requested">beep.requested</option>
        <option value="budget.flushed">budget.flushed</option>
        <option value="quiet.suppressed">quiet.suppressed</option>
      </select>
      <label for="audit-source-filter">Station</label>
      <select id="audit-source-filter" data-testid="audit-source-filter"><option value="">All</option></select>
      <button type="button" id="audit-prev" data-testid="audit-prev">Newer</button>
      <button type="button" id="audit-next" data-testid="audit-next">Older</button>
      <span id="audit-position" data-testid="audit-position" class="sub"></span>
    </div>
    <ol id="audit-list" data-testid="audit-list" class="audit"></ol>
    <p id="audit-empty" data-testid="audit-empty" class="empty" hidden>No event matches this filter.</p>
  </section>

  <section aria-labelledby="dryrun-h" data-testid="dryrun-panel" class="card wide">
    <h2 id="dryrun-h">Rules dry run <span class="sub">(BIP-F-32 — classifies, never beeps)</span></h2>
    <form id="dryrun-form" data-testid="dryrun-form">
      <label for="dryrun-input">Command</label>
      <textarea id="dryrun-input" data-testid="dryrun-input" rows="3" maxlength="4000"
        spellcheck="false" placeholder="e.g. git push --force origin main"></textarea>
      <button type="submit" id="dryrun-submit" data-testid="dryrun-submit">Classify</button>
    </form>
    <div id="dryrun-result" data-testid="dryrun-result" class="dryrun-result" hidden>
      <p>Line: <output id="dryrun-line" data-testid="dryrun-line" class="line"></output></p>
      <p>Code: <output id="dryrun-code" data-testid="dryrun-code"></output>
         &middot; Level: <output id="dryrun-risk" data-testid="dryrun-risk"></output>
         &middot; Verb: <output id="dryrun-verb" data-testid="dryrun-verb"></output>
         &middot; Matched by: <output id="dryrun-matched" data-testid="dryrun-matched"></output></p>
    </div>
    <p id="dryrun-error" data-testid="dryrun-error" role="alert" class="banner error" hidden></p>
  </section>

</main>
<script src="/dashboard/app.js"></script>
</body>
</html>
`;
