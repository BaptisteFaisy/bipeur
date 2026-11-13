/**
 * The rehearsal helper: a **device** that answers pages for you.
 *
 * It pairs with the Central like the pager does (a real ECDSA key, a real
 * device token), watches its own pending pages, and signs a decision for each
 * one — the very same path the PWA and the emulator use. It exists so the
 * demo can be rehearsed end to end without a thumb on the pager.
 *
 *   node tools/demo/auto-approve.mjs <pairing-code> [approved|denied] [seconds]
 *
 * The pairing code comes from the dashboard (or from `POST /v1/pairings` with
 * a station token); it is single use and lives five minutes.
 */
import { buildDecision, createCentralApi } from '../../packages/pager-emu/dist/index.js';
import { cryptoPort, generateDeviceKeys } from '../../packages/core/dist/index.js';

const CENTRAL = process.env.BIPEUR_URL ?? 'https://r630-debian.tail3a8bdf.ts.net';
const code = process.argv[2];
const verdict = process.argv[3] === 'denied' ? 'denied' : 'approved';
const seconds = Number(process.argv[4] ?? 120);

if (!code) {
  console.error('usage: auto-approve.mjs <pairing-code> [approved|denied] [seconds]');
  process.exit(2);
}

const port = cryptoPort(globalThis.crypto);
const keys = await generateDeviceKeys(port);
const api = createCentralApi({ baseUrl: CENTRAL });
const pairing = await api.pair(code, keys.publicKeyJwk, 'demo-rehearsal');
console.log(`paired as ${pairing.deviceId}`);

async function pendingPages() {
  const response = await fetch(`${CENTRAL}/v1/devices/${pairing.deviceId}/pages?state=pending`, {
    headers: { authorization: `Bearer ${pairing.token}` },
  });
  if (!response.ok) return [];
  const body = await response.json();
  return body.pages ?? [];
}

const deadline = Date.now() + seconds * 1000;
const seen = new Set();
let answered = 0;
while (Date.now() < deadline) {
  for (const page of await pendingPages()) {
    const pageId = page.id ?? page.page_id ?? '';
    if (!pageId || seen.has(pageId)) continue;
    seen.add(pageId);
    const fingerprint =
      page.fingerprint ?? (await api.fingerprintOf(pageId, pairing.deviceId, pairing.token)) ?? '';
    const decision = await buildDecision(
      {
        pageId,
        fingerprint,
        verdict: verdict === 'approved' ? 'approve' : 'deny',
        choice: null,
        deviceId: pairing.deviceId,
        hasOptions: false,
        now: Date.now(),
      },
      keys,
    );
    try {
      const ack = await api.postDecision(pageId, decision, pairing.token);
      console.log(`page ${pageId}: ${verdict} — ${ack.accepted ? 'accepted' : 'refused'}`);
      answered += 1;
    } catch (error) {
      // 409: another device answered first (the real pager, most likely).
      console.log(`page ${pageId}: already decided elsewhere — ${String(error.message).slice(0, 60)}`);
    }
  }
  await new Promise((done) => setTimeout(done, 500));
}
if (answered === 0) console.log('no page arrived before the deadline');
else console.log(`${answered} page(s) answered`);
process.exit(answered > 0 ? 0 : 1);
