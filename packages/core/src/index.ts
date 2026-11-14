/**
 * @bipeur/core — the shared contract of Beeper.
 *
 * This entry point is browser-safe: no Node API. Hashing and signature
 * verification live in `@bipeur/core/node`. The device key — the WebCrypto
 * glue of the PWA and of the emulator — lives here too, so both sign the
 * same way.
 */
export * from './types.js';
export * from './ascii.js';
export * from './canonical.js';
export * from './codes.js';
export * from './diff.js';
export * from './line.js';
export * from './states.js';
export * from './time.js';
export * from './budget.js';
export * from './rules.js';
export * from './decision.js';
export * from './schema.js';
export * from './device-key.js';
