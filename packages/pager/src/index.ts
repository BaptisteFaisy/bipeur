/**
 * `@bipeur/pager` — the Beeper device itself (BIP-F-15 … BIP-F-23).
 * The app is mounted from `main.tsx`; this entry exposes the pieces a test or
 * another package may want to reuse.
 */
export { App, type AppProps } from './App.js';
export { PagerProvider, usePager, type PagerApi } from './state/PagerContext.js';
export { createCentralClient, type CentralClient } from './api/client.js';
export { buildSignedDecision } from './state/decide.js';
export { translate } from './i18n/index.js';

export const PACKAGE_NAME = '@bipeur/pager';
