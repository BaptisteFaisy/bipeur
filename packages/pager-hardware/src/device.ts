/**
 * The device key of the hardware pager (BIP-F-15, BIP-F-18) — the very key
 * of `@bipeur/core`, shared with the PWA and the emulator.
 *
 * A non-extractable ECDSA P-256 pair: WebCrypto keeps the private half inside
 * the process, only the public half travels to the Central as a JWK, and the
 * Central verifies every decision against it. There is no implementation here:
 * the hardware pager signs exactly like every other pager because they all
 * call the same module of the core.
 */
import {
  cryptoPort,
  DeviceKeyUnavailable,
  generateDeviceKeys,
  type DeviceKeys,
} from '@bipeur/core';

export { DeviceKeyUnavailable };

/** The key pair of the device: the private half never leaves the process. */
export type DeviceKey = DeviceKeys;

/**
 * Create the key pair. `extractable: false` applies to the private key only;
 * WebCrypto always keeps the public key exportable, which the pairing needs.
 */
export async function generateDeviceKey(cryptoImpl: Crypto = globalThis.crypto): Promise<DeviceKey> {
  if (!cryptoImpl?.subtle) throw new DeviceKeyUnavailable();
  return generateDeviceKeys(cryptoPort(cryptoImpl));
}