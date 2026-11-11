/** A real non-extractable device key pair for the tests that sign decisions. */
import { browserCrypto, generateDeviceKeys, type DeviceKeys } from '../../src/crypto/device-key.js';

export async function testKeys(): Promise<DeviceKeys> {
  const port = browserCrypto();
  if (!port) throw new Error('WebCrypto is required to run the pager tests');
  return generateDeviceKeys(port);
}

export const TEST_DEVICE = { id: 'dev_fake1', name: 'Beeper', pairedAt: 0 };
