/**
 * The identity of the emulator (BIP-F-15, BIP-F-18) — the device key of
 * `@bipeur/core`, shared with the PWA.
 *
 * A non-extractable ECDSA P-256 key pair, exactly like the PWA creates it:
 * WebCrypto keeps the private half inside the process, the public half
 * travels to the Central as a JWK, and the Central verifies every decision
 * with it. The signature is the raw `r||s` (IEEE P1363) of the WebCrypto,
 * base64 encoded — the format `verifyDecisionSignature` reads.
 *
 * There is no implementation here: the emulator signs exactly like the pager,
 * because both call the same module of the core.
 */
import {
  cryptoPort,
  DeviceKeyUnavailable,
  ECDSA_ALGORITHM,
  generateDeviceKeys,
  signBytes,
  SIGN_ALGORITHM,
  type DeviceKeys,
} from '@bipeur/core';

export { DeviceKeyUnavailable, ECDSA_ALGORITHM, SIGN_ALGORITHM, signBytes };

/** The key pair of a device: the private half never leaves the process. */
export type DeviceKey = DeviceKeys;

/**
 * Create the key pair. `extractable: false` applies to the private key only:
 * WebCrypto always keeps the public key exportable, which is what the
 * pairing needs.
 */
export async function generateDeviceKey(cryptoImpl: Crypto = globalThis.crypto): Promise<DeviceKey> {
  if (!cryptoImpl?.subtle) throw new DeviceKeyUnavailable();
  return generateDeviceKeys(cryptoPort(cryptoImpl));
}
