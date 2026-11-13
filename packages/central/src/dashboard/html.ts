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

  <section aria-labelledby="rota-h" data-testid="rota-panel" class="card">
    <h2 id="rota-h">On-call rotas <span class="sub">(BIP-F-37)</span></h2>
    <table class="list">
      <thead><tr><th scope="col">Rota</th><th scope="col">On call</th>
        <th scope="col">Escalates after</th><th scope="col">Shifts</th></tr></thead>
      <tbody id="rota-list" data-testid="rota-list"></tbody>
    </table>
    <p id="rota-empty" data-testid="rota-empty" class="empty" hidden>No rota. Paging one person stays the default.</p>
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
