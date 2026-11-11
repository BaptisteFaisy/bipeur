/*
 * BIP-F-19 — the notification layer of the pager.
 *
 * Loaded by the generated service worker (`workbox.importScripts`). It never
 * plays a sound (BIP-N-06): the notification is silent by construction.
 *
 * A green page offers "Approve" and "Refuse" where the platform allows
 * action buttons. Amber and red open the pager: a red page always needs the
 * open pager and a one-second press-and-hold.
 *
 * The service worker cannot sign a decision — the private key is
 * non-extractable and lives in the page — so an action is forwarded to the
 * open pager, which signs it. When the pager is closed, the action opens it.
 */
/* global self */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const risk = payload.risk === 'red' || payload.risk === 'amber' ? payload.risk : 'green';
  // BIP-F-21 / BIP-N-04: when the operator asked for lock-screen masking the
  // Central omits the line; the notification is reduced to code + station. The
  // flag is honoured here too, so a payload that still carried a line could not
  // leak it onto a locked screen.
  const masked = payload.masked === true;
  const title =
    (masked ? '' : payload.title) || `${payload.code || ''} ${payload.station || ''}`.trim() || 'Beeper';
  const options = {
    body: masked ? '' : payload.line || payload.body || '',
    tag: payload.page_id || 'bipeur',
    renotify: true,
    requireInteraction: risk === 'red',
    data: { page_id: payload.page_id ?? null, risk },
  };
  if (risk === 'green') {
    options.actions = [
      { action: 'approve', title: 'Approve' },
      { action: 'deny', title: 'Refuse' },
    ];
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  const pageId = data.page_id;
  const action = event.action;
  event.notification.close();
  const message = {
    type: 'bipeur:action',
    action: action === 'approve' || action === 'deny' ? action : 'open',
    page_id: pageId ?? null,
  };
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('postMessage' in client) {
          client.postMessage(message);
          return client.focus();
        }
      }
      let query = pageId ? `?page=${encodeURIComponent(pageId)}` : '';
      if (message.action !== 'open') query += `&action=${message.action}`;
      return self.clients.openWindow(`/${query}`);
    }),
  );
});
