/**
 * P1 — appairer son bipeur (A.5).
 *
 * The Central shows a pairing code and a QR link, the pager registers itself
 * with a non-extractable ECDSA P-256 key, and the Central then counts one
 * paired pager. The link is single use, and a wrong code pairs nothing.
 */
import { expect, test } from '@playwright/test';
import { pairPager } from './helpers/flows.js';
import { openPager } from './helpers/pager.js';
import { startDedicatedCentral } from './helpers/server.js';

test('P1 — pair the pager: the Central shows one paired pager', async ({ page }) => {
  const dedicated = await startDedicatedCentral(8811);
  try {
    const central = dedicated.central;
    const pairing = await central.createPairing();
    expect(pairing.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(pairing.qr_url).toContain(pairing.code);
    expect(pairing.pair_url).toContain(pairing.code);
    expect(pairing.expires_at - Date.now()).toBeGreaterThan(4 * 60 * 1000);

    const session = await pairPager(page, central);
    expect(session.deviceId).toMatch(/^dev_/);
    const devices = await central.devices();
    expect(devices.devices).toHaveLength(1);
    expect(devices.devices[0].name).toBe('Beeper');

    const events = await central.audit(20, 'device.paired');
    expect(events.events.length).toBe(1);
  } finally {
    await dedicated.stop();
  }
});

test('P1 — the pairing link is single use, and a wrong code pairs nothing', async () => {
  const dedicated = await startDedicatedCentral(8812);
  try {
    const central = dedicated.central;
    const pairing = await central.createPairing();
    const first = await central.pairDevice(pairing);
    expect(first.deviceId).toMatch(/^dev_/);
    const second = await fetch(`${central.url}/v1/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pairing_id: pairing.pairing_id,
        code: pairing.code,
        device_name: 'Second pager',
        public_key_jwk: first.publicKeyJwk,
      }),
    });
    expect(second.status).toBe(409);

    const fresh = await central.createPairing();
    const wrong = await fetch(`${central.url}/v1/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pairing_id: fresh.pairing_id,
        code: 'AAAAAA',
        device_name: 'Wrong pager',
        public_key_jwk: first.publicKeyJwk,
      }),
    });
    expect(wrong.status).toBe(422);
    expect(((await wrong.json()) as { error: string }).error).toBe('wrong_code');
  } finally {
    await dedicated.stop();
  }
});

test('P1 — the pairing screen shows the QR note and the unpaired state', async ({ page }) => {
  const dedicated = await startDedicatedCentral(8813);
  try {
    await openPager(page, dedicated.central.url);
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('button', { name: 'Pair' }).click();
    await expect(page.getByTestId('pairing-state')).toContainText('No device paired yet');
    await expect(page.getByTestId('pairing-qr-note')).toContainText('QR code');
    await expect(page.getByTestId('pair-code')).toBeVisible();
  } finally {
    await dedicated.stop();
  }
});
