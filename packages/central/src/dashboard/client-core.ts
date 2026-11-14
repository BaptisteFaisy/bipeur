/**
 * Client script, part 1 of 2: state, helpers, API access, polling and event
 * wiring. Served as plain text (no build step, no framework, no eval). Every
 * value coming from the API is rendered with `textContent` — a page line is
 * data, never markup (BIP-N-08). Polling is bounded: 5 s, paused while the tab
 * is hidden.
 */
export const CLIENT_CORE = `
var TOKEN_KEY = 'bipeur.central.dashboard.token';
var POLL_MS = 5000;
var AUDIT_LIMIT = 25;
var pollTimer = null;
var auditOffset = 0;
var sourceById = {};

function $(id) { return document.getElementById(id); }

function h(tag, className, text) {
  var el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}

function clearNode(el) { while (el.firstChild) el.removeChild(el.firstChild); }

function getToken() { return sessionStorage.getItem(TOKEN_KEY) || ''; }

function setToken(value) { sessionStorage.setItem(TOKEN_KEY, value); }

function shortFp(fingerprint) {
  return typeof fingerprint === 'string' && fingerprint.length >= 8
    ? '#' + fingerprint.slice(0, 8) : '';
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return Math.round(ms) + ' ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
  var minutes = ms / 60000;
  if (minutes < 60) return minutes.toFixed(1) + ' min';
  return (minutes / 60).toFixed(1) + ' h';
}

function fmtAgo(ts, now) {
  if (!ts) return '—';
  var delta = now - ts;
  if (delta < 5000) return 'just now';
  if (delta < 60000) return Math.floor(delta / 1000) + 's ago';
  if (delta < 3600000) return Math.floor(delta / 60000) + 'min ago';
  if (delta < 86400000) return Math.floor(delta / 3600000) + 'h ago';
  return Math.floor(delta / 86400000) + 'd ago';
}

function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function riskParts(risk) {
  if (risk === 'red') return { symbol: '\\u25a0', label: 'red' };
  if (risk === 'amber') return { symbol: '\\u25b2', label: 'amber' };
  return { symbol: '\\u25cf', label: 'green' };
}

function riskBadge(risk) {
  var parts = riskParts(risk);
  return h('span', 'badge ' + parts.label, parts.symbol + ' ' + parts.label);
}

function showError(message) {
  var banner = $('error-banner');
  banner.textContent = message;
  banner.hidden = false;
}

function clearError() { $('error-banner').hidden = true; }

function setStatus(message) { $('status-banner').textContent = message; }

function api(path, options) {
  var opts = options || {};
  var headers = { authorization: 'Bearer ' + getToken() };
  if (opts.body) headers['content-type'] = 'application/json';
  return fetch(path, { method: opts.method || 'GET', headers: headers, body: opts.body })
    .then(function (response) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Token refused by the Central (' + response.status + '). Paste a valid station token above.');
      }
      if (!response.ok) throw new Error('Request failed: ' + response.status + ' ' + path);
      return response.json();
    });
}

function auditQuery() {
  var type = $('audit-type-filter').value;
  var source = $('audit-source-filter').value;
  var query = '?limit=' + AUDIT_LIMIT + '&offset=' + auditOffset;
  if (type) query += '&type=' + encodeURIComponent(type);
  if (source) query += '&source=' + encodeURIComponent(source);
  return query;
}

function refresh() {
  if (!getToken()) {
    setStatus('Paste a station token above to load live data.');
    return;
  }
  var now = Date.now();
  Promise.all([
    api('/v1/metrics'),
    api('/v1/sources'),
    api('/v1/pages?state=pending'),
    api('/v1/audit' + auditQuery()),
    api('/v1/rotas'),
    api('/v1/metrics/attention'),
  ]).then(function (results) {
    clearError();
    renderMetrics(results[0]);
    renderSources(results[1].sources, now);
    renderQueue(results[2].pages, now);
    renderAudit(results[3].events);
    renderRotas(results[4].rotas);
    renderAttention(results[5]);
    setStatus('Updated ' + fmtClock(now) + ' — polling every ' + (POLL_MS / 1000) + ' s.');
  }).catch(function (error) {
    showError(error.message || String(error));
  });
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(function () {
    if (!document.hidden) refresh();
  }, POLL_MS);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function onTokenSubmit(event) {
  event.preventDefault();
  var value = $('token-input').value.trim();
  if (!value) return;
  setToken(value);
  $('token-input').value = '';
  clearError();
  refresh();
  startPolling();
}

function onTokenClear() {
  sessionStorage.removeItem(TOKEN_KEY);
  stopPolling();
  clearError();
  setStatus('Token cleared. Paste a station token to load live data.');
}

function onAuditNav(delta) {
  auditOffset = Math.max(0, auditOffset + delta);
  refresh();
}

function init() {
  $('token-form').addEventListener('submit', onTokenSubmit);
  $('token-clear').addEventListener('click', onTokenClear);
  $('audit-type-filter').addEventListener('change', function () { auditOffset = 0; refresh(); });
  $('audit-source-filter').addEventListener('change', function () { auditOffset = 0; refresh(); });
  $('audit-prev').addEventListener('click', function () { onAuditNav(-AUDIT_LIMIT); });
  $('audit-next').addEventListener('click', function () { onAuditNav(AUDIT_LIMIT); });
  $('dryrun-form').addEventListener('submit', onDryRunSubmit);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stopPolling(); return; }
    refresh();
    startPolling();
  });
  if (getToken()) { refresh(); startPolling(); }
  else setStatus('Paste a station token above to load live data.');
}

document.addEventListener('DOMContentLoaded', init);
`;
