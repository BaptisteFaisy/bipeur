/**
 * Dashboard styles (A.11: the Central is sober and readable — the retro look
 * stops at the pager case). AA contrast on every pair, risk shown by colour
 * AND by a symbol plus a word, visible focus, and no motion unless the user
 * allows it (prefers-reduced-motion).
 */
export const DASHBOARD_CSS = `
:root {
  --bg: #f4f5f7;
  --card: #ffffff;
  --ink: #1c2128;
  --ink-soft: #4a525e;
  --line: #d3d8de;
  --accent: #0b57d0;
  --green-ink: #14532d;
  --green-bg: #dcfce7;
  --amber-ink: #713f12;
  --amber-bg: #fef3c7;
  --red-ink: #7f1d1d;
  --red-bg: #fee2e2;
  --held-bg: #e8eaed;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
code, .line, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.topbar {
  padding: 1rem 1.25rem;
  background: var(--card);
  border-bottom: 1px solid var(--line);
}
.topbar h1 { margin: 0; font-size: 1.4rem; letter-spacing: 0.02em; }
.tagline { margin: 0.15rem 0 0.75rem; color: var(--ink-soft); }
.tagline a { color: var(--accent); }
.token-form { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.token-form input {
  flex: 1 1 16rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--card);
  color: var(--ink);
}
.hint { margin: 0.5rem 0 0; color: var(--ink-soft); font-size: 0.85rem; }
button {
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--card);
  color: var(--ink);
  cursor: pointer;
}
button:hover { border-color: var(--accent); color: var(--accent); }
button:disabled { opacity: 0.5; cursor: default; }
:is(a, button, input, select, textarea):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.banner { padding: 0.6rem 1.25rem; margin: 0; border-bottom: 1px solid var(--line); }
.banner.error { background: var(--red-bg); color: var(--red-ink); }
.banner.status { background: transparent; color: var(--ink-soft); font-size: 0.85rem; }
.grid {
  display: grid;
  gap: 1rem;
  padding: 1rem 1.25rem 2rem;
  grid-template-columns: repeat(auto-fit, minmax(21rem, 1fr));
  align-items: start;
}
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0.9rem 1rem 1.1rem;
}
.card.wide { grid-column: 1 / -1; }
.card h2 { margin: 0 0 0.6rem; font-size: 1.05rem; }
.sub { color: var(--ink-soft); font-size: 0.8rem; font-weight: normal; }
.counter { margin: 0 0 0.6rem; font-weight: 600; }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.6rem; margin: 0; }
.metrics div { border: 1px solid var(--line); border-radius: 6px; padding: 0.5rem 0.6rem; }
.metrics dt { color: var(--ink-soft); font-size: 0.8rem; }
.metrics dd { margin: 0; font-size: 1.15rem; font-weight: 600; }
.metrics .note { font-size: 0.75rem; color: var(--ink-soft); font-weight: normal; }
.queue, .audit { list-style: none; margin: 0; padding: 0; }
.queue li, .audit li {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 0.5rem 0.65rem;
  margin-bottom: 0.5rem;
}
.queue .line { display: block; font-size: 0.95rem; word-break: break-all; }
.meta { color: var(--ink-soft); font-size: 0.8rem; }
.badge {
  display: inline-block;
  border-radius: 4px;
  padding: 0.05rem 0.45rem;
  font-size: 0.8rem;
  font-weight: 600;
  border: 1px solid transparent;
}
.badge.green { background: var(--green-bg); color: var(--green-ink); border-color: var(--green-ink); }
.badge.amber { background: var(--amber-bg); color: var(--amber-ink); border-color: var(--amber-ink); }
.badge.red { background: var(--red-bg); color: var(--red-ink); border-color: var(--red-ink); }
.held { background: var(--held-bg); border-left: 4px solid var(--ink-soft); }
.held .why { font-weight: 600; }
table.list { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
table.list th, table.list td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--line); }
table.list th { color: var(--ink-soft); font-size: 0.8rem; }
.revoked { color: var(--red-ink); font-weight: 600; }
.filters { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.7rem; }
.filters select {
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--card);
  color: var(--ink);
}
.audit .type { font-weight: 600; }
.audit .fp { color: var(--ink-soft); }
.empty { color: var(--ink-soft); font-style: italic; }
#dryrun-form { display: flex; gap: 0.5rem; align-items: flex-start; flex-wrap: wrap; }
#dryrun-form label { flex-basis: 100%; font-weight: 600; }
#dryrun-input {
  flex: 1 1 20rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--card);
  color: var(--ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.dryrun-result { margin-top: 0.7rem; border: 1px dashed var(--line); border-radius: 6px; padding: 0.6rem; }
.dryrun-result .line { word-break: break-all; }
.visually-hidden {
  position: absolute; width: 1px; height: 1px;
  margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
`;
