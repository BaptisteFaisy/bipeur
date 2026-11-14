/**
 * Client script, part 2 of 2: the renderers and the dry-run handler. Same
 * discipline as part 1 — DOM built with createElement/textContent only, no
 * innerHTML, no eval; every API value stays data (BIP-N-03, BIP-N-08). The
 * audit view whitelists the event data keys it shows, so a payload could never
 * surface even if one slipped into the log.
 */
export const CLIENT_RENDER = `
var AUDIT_DATA_KEYS = ['reason', 'risk', 'code', 'latency_ms', 'verdict', 'reminder', 'released', 'default', 'in_use', 'budget', 'choice'];

function renderMetrics(data) {
  $('metrics-counter').textContent = data.events_seen + ' events, ' + data.pages_created + ' pages';
  $('metric-decision-median').textContent = fmtMs(data.decision_median_ms);
  $('metric-filter-rate').textContent = (data.filter_rate * 100).toFixed(1) + ' %';
  $('metric-unblocked').textContent = fmtMs(data.unblocked_ms);
  $('metric-orphans').textContent = String(data.orphan_approvals);
  $('metric-delivery-p95').textContent = fmtMs(data.delivery_p95_ms);
  $('metric-budget').textContent = data.in_use + ' / ' + data.budget_per_hour;
  $('metric-delivered').textContent = String(data.pages_delivered);
}

/** The attention bill (BIP-F-44): what the human actually spent, per station. */
function renderAttention(report) {
  var total = report.total;
  $('attention-total').textContent = total.human_minutes + ' minutes, ' + total.pages + ' pages';
  $('attention-human').textContent = fmtMs(total.human_ms);
  $('attention-denial').textContent = (total.denial_rate * 100).toFixed(1) + ' %';
  $('attention-rate').textContent = String(total.interruptions_per_hour);
  $('attention-median').textContent = fmtMs(total.decision_median_ms);
  $('attention-undecided').textContent = String(total.read - total.decided);
  var body = $('attention-list');
  clearNode(body);
  $('attention-empty').hidden = report.stations.length > 0;
  for (var i = 0; i < report.stations.length; i++) {
    var row = report.stations[i];
    body.appendChild(h('tr', null,
      h('td', null, row.alias),
      h('td', null, String(row.cost.pages)),
      h('td', null, row.cost.human_minutes + ' min'),
      h('td', null, row.cost.denied + ' / ' + row.cost.decided)));
  }
  renderSpark(report.series);
}

/** One bar per hour. A gap is a fact, so empty hours stay drawn. */
function renderSpark(series) {
  var box = $('attention-spark');
  clearNode(box);
  var peak = 0;
  for (var i = 0; i < series.length; i++) peak = Math.max(peak, series[i].pages);
  for (var j = 0; j < series.length; j++) {
    var bucket = series[j];
    var ratio = peak > 0 ? bucket.pages / peak : 0;
    box.appendChild(h('span', {
      class: 'spark-bar',
      title: fmtClock(bucket.at) + ' — ' + bucket.pages + ' pages, ' + Math.round(bucket.human_ms / 60000) + ' min',
      style: 'height:' + Math.max(2, Math.round(ratio * 100)) + '%',
    }, null));
  }
}

function renderSources(sources, now) {
  var body = $('sources-list');
  clearNode(body);
  sourceById = {};
  var select = $('audit-source-filter');
  var currentSource = select.value;
  clearNode(select);
  select.appendChild(h('option', null, 'All'));
  $('sources-empty').hidden = sources.length > 0;
  sources.forEach(function (source) {
    sourceById[source.source_id] = source.alias;
    body.appendChild(sourceRow(source, now));
    var option = h('option', null, source.alias);
    option.value = source.source_id;
    select.appendChild(option);
  });
  select.value = sourceById[currentSource] ? currentSource : '';
}

function sourceRow(source, now) {
  var row = h('tr');
  row.appendChild(h('td', 'mono', source.alias));
  row.appendChild(h('td', null, source.kind));
  row.appendChild(h('td', null, source.revoked_at ? 'revoked' : fmtAgo(source.last_seen_at, now)));
  row.appendChild(h('td', null, String(source.pages_created)));
  var cell = h('td');
  if (source.revoked_at) cell.appendChild(h('span', 'revoked', 'revoked'));
  else cell.appendChild(revokeButton(source));
  row.appendChild(cell);
  return row;
}

function revokeButton(source) {
  var button = h('button', null, 'Revoke');
  button.setAttribute('data-testid', 'revoke-' + source.alias);
  button.addEventListener('click', function () {
    var ok = window.confirm('Revoke station "' + source.alias + '"? Its token stops working immediately.');
    if (!ok) return;
    api('/v1/sources/' + encodeURIComponent(source.source_id), { method: 'DELETE' })
      .then(function () { clearError(); refresh(); })
      .catch(function (error) { showError(error.message || String(error)); });
  });
  return button;
}

function renderRotas(rotas) {
  var body = $('rota-list');
  clearNode(body);
  $('rota-empty').hidden = rotas.length > 0;
  rotas.forEach(function (rota) { body.appendChild(rotaRow(rota)); });
}

function rotaRow(rota) {
  var row = h('tr');
  row.appendChild(h('td', 'mono', rota.label));
  row.appendChild(h('td', null, rota.on_call || '\\u2014'));
  var windowText = 'after ' + fmtMs(rota.escalate_after_ms);
  if (rota.rotation_ms) windowText += ' \\u00b7 rotates ' + fmtMs(rota.rotation_ms);
  row.appendChild(h('td', null, windowText));
  row.appendChild(h('td', null, String(rota.shifts.length)));
  return row;
}

function renderQueue(pages, now) {
  var list = $('queue-list');
  clearNode(list);
  $('queue-empty').hidden = pages.length > 0;
  pages.forEach(function (page) { list.appendChild(queueItem(page, now)); });
}

function queueItem(page, now) {
  var item = h('li', page.hold ? 'held' : null);
  var head = h('div');
  head.appendChild(riskBadge(page.risk));
  head.appendChild(h('span', 'mono', ' ' + page.code + ' '));
  head.appendChild(h('span', 'meta', page.station + ' · ' + shortFp(page.fingerprint)));
  item.appendChild(head);
  item.appendChild(h('code', 'line', page.line));
  var age = fmtAgo(page.created_at, now);
  var due = page.expires_at > now ? 'due in ' + fmtAgo(page.created_at, page.expires_at) : 'past due';
  item.appendChild(h('div', 'meta', page.state + ' · ' + age + ' · ' + due));
  if (page.hold) item.appendChild(holdNote(page.hold.reason));
  return item;
}

function holdNote(reason) {
  var why = reason === 'quiet'
    ? 'Held: quiet hours — only red and family 9 pages are delivered.'
    : 'Held: attention budget full — will flush as a burst when a slot frees.';
  return h('div', 'why', why);
}

function renderAudit(events) {
  var list = $('audit-list');
  clearNode(list);
  $('audit-empty').hidden = events.length > 0;
  $('audit-prev').disabled = auditOffset === 0;
  $('audit-next').disabled = events.length < AUDIT_LIMIT;
  $('audit-position').textContent = 'offset ' + auditOffset;
  events.forEach(function (event) { list.appendChild(auditItem(event)); });
}

function auditItem(event) {
  var item = h('li');
  var head = h('div');
  head.appendChild(h('span', 'type', event.type));
  head.appendChild(h('span', 'meta', ' ' + fmtClock(event.ts) + ' · ' + (sourceById[event.source_id] || '—')));
  if (event.fingerprint) head.appendChild(h('span', 'fp mono', ' · ' + shortFp(event.fingerprint)));
  item.appendChild(head);
  var facts = auditFacts(event.data);
  if (facts) item.appendChild(h('div', 'meta', facts));
  return item;
}

function auditFacts(data) {
  if (!data) return null;
  var parts = [];
  AUDIT_DATA_KEYS.forEach(function (key) {
    var value = data[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parts.push(key + '=' + String(value).slice(0, 40));
    }
  });
  return parts.length > 0 ? parts.join(' · ') : null;
}

function onDryRunSubmit(event) {
  event.preventDefault();
  var command = $('dryrun-input').value.trim();
  var errorBox = $('dryrun-error');
  var result = $('dryrun-result');
  errorBox.hidden = true;
  if (!command) {
    errorBox.textContent = 'Type or paste a command first.';
    errorBox.hidden = false;
    return;
  }
  api('/v1/rules/dry-run', { method: 'POST', body: JSON.stringify({ command: command }) })
    .then(function (answer) {
      result.hidden = false;
      $('dryrun-line').textContent = answer.line;
      $('dryrun-code').textContent = String(answer.code);
      var badge = riskBadge(answer.risk);
      var riskOut = $('dryrun-risk');
      clearNode(riskOut);
      riskOut.appendChild(badge);
      $('dryrun-verb').textContent = answer.verb || '';
      $('dryrun-matched').textContent = answer.matched_by || '';
    })
    .catch(function (error) {
      result.hidden = true;
      errorBox.textContent = error.message || String(error);
      errorBox.hidden = false;
    });
}
`;
