/**
 * The device key of the pager (BIP-F-15, BIP-F-18).
 *
 * The implementation now lives in `@bipeur/core`: the PWA and the emulator
 * (`@bipeur/pager-emu`) share ONE device key, so they can never drift on the
 * signature format, on the public JWK or on the error handling.
 *
 * This file only re-exports it: the import path of the pager stays the same,
 * and there is nothing left here but the name of the shared module.
 */
export {
  browserCrypto,
  DeviceKeyUnavailable,
  ECDSA_ALGORITHM,
  generateDeviceKeys,
  importDeviceKeys,
  newNonce,
  randomHex,
  signClaims,
  SIGN_ALGORITHM,
  supportsDeviceKeys,
  type CryptoPort,
  type DeviceKeys,
} from '@bipeur/core';
