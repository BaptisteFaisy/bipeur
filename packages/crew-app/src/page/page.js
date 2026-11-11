/**
 * Dashboard page of the Crew app: the pager screen and the approvals still
 * waiting. No dependency, no build step, no sound.
 *
 * Read-only by design: a decision must be signed by the paired pager, so this
 * page never posts one. The feed URL is a placeholder to verify against the
 * Central API reference (see the app README).
 */
(function () {
  'use strict';

  var CONFIG = {
    feedUrl: '/v1/pages?state=queued',
    pollMs: 3000,
    rows: 4,
    cols: 20,
  };

  var el = {
    state: document.getElementById('state'),
    lamp: document.getElementById('lamp'),
    lcd: document.getElementById('lcd'),
    pending: document.getElementById('pending'),
  };

  function token() {
    try {
      return window.localStorage.getItem('bipeur.token') || '';
    } catch {
      return '';
    }
  }

  /** Split a page line into the 4 rows of 20 columns of the screen. */
  function rows(line) {
    var out = [];
    for (var i = 0; i < CONFIG.rows; i += 1) {
      out.push(line.slice(i * CONFIG.cols, (i + 1) * CONFIG.cols));
    }
    return out;
  }

  function writeLcd(lines, empty) {
    el.lcd.textContent = '';
    var source = lines.length > 0 ? lines : empty;
    for (var i = 0; i < CONFIG.rows; i += 1) {
      var row = document.createElement('div');
      row.className = 'row' + (lines.length > 0 ? '' : ' empty');
      row.textContent = source[i] || '';
      el.lcd.appendChild(row);
    }
  }

  function setState(text) {
    el.state.textContent = text;
  }

  function setLamp(risk) {
    el.lamp.setAttribute('data-risk', risk === 'red' || risk === 'amber' ? risk : 'green');
  }

  function cell(text) {
    var td = document.createElement('td');
    td.textContent = text;
    return td;
  }

  function renderPending(pages) {
    el.pending.textContent = '';
    if (pages.length === 0) {
      var row = document.createElement('tr');
      var td = cell('No approval waiting.');
      td.colSpan = 4;
      row.appendChild(td);
      el.pending.appendChild(row);
      return;
    }
    pages.forEach(function (page) {
      var tr = document.createElement('tr');
      tr.appendChild(cell(String(page.code || '')));
      tr.appendChild(cell(String(page.source_alias || page.station || '')));
      tr.appendChild(cell(String(page.line || '')));
      tr.appendChild(cell(waiting(page.created_at)));
      el.pending.appendChild(tr);
    });
  }

  function waiting(createdAt) {
    if (typeof createdAt !== 'number') return '';
    var seconds = Math.max(0, Math.round((Date.now() - createdAt) / 1000));
    if (seconds < 60) return seconds + 's';
    return Math.round(seconds / 60) + 'm';
  }

  function render(pages) {
    var first = pages[0];
    if (!first) {
      writeLcd([], ['No pages.', 'Your agents are fine.']);
      setLamp('green');
      return;
    }
    writeLcd(rows(String(first.line || '')), []);
    setLamp(first.risk);
  }

  function poll() {
    var headers = token() ? { authorization: 'Bearer ' + token() } : {};
    fetch(CONFIG.feedUrl, { headers: headers })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (body) {
        var pages = Array.isArray(body) ? body : body.pages || [];
        render(pages);
        renderPending(pages);
        setState(pages.length + ' waiting');
      })
      .catch(function () {
        writeLcd([], ['OFFLINE', 'Central unreachable.']);
        setLamp('red');
        setState('offline');
      });
  }

  poll();
  window.setInterval(poll, CONFIG.pollMs);
})();
