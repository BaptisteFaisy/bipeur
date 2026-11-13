/** A real non-extractable device key pair for the tests that sign decisions. */
import { browserCrypto, generateDeviceKeys, type DeviceKeys } from '../../src/crypto/device-key.js';

export async function testKeys(): Promise<DeviceKeys> {
  const port = browserCrypto();
  if (!port) throw new Error('WebCrypto is required to run the pager tests');
  return generateDeviceKeys(port);
}

export const TEST_DEVICE_TOKEN = 'tok_fake_device';
export const TEST_DEVICE = {
  id: 'dev_fake1',
  name: 'Beeper',
  pairedAt: 0,
  token: TEST_DEVICE_TOKEN,
};

/**
 * A throwaway P-256 private JWK, generated for this suite and used by no real
 * device. The demo space hands its key over in the clear (that is what makes
 * "Start demo" work without pairing); a test needs one to import.
 */
export const TEST_DEMO_PRIVATE_JWK: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'B6Gc-zlqbltKPCex_aq3HlLBJYetzSDddwUO5GckJLs',
  y: 'Gt83muzCnJONRDqd32x-XUK-CiAhWRywcg7IOovdAoA',
  d: 'Puo_fXdfHBxPKmaCNTs6ErcKytD_S7Mc8Vo_nQY_B3U',
};
