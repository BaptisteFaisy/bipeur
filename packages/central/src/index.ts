/**
 * @bipeur/central — the Central of Beeper: HTTP API, WebSocket stream, SQLite
 * store, audit log, attention budget, simulator (lot A1 and part of A4).
 */
export const PACKAGE_NAME = '@bipeur/central';

export { CENTRAL_VERSION, loadConfig, type Config, type VapidConfig } from './config.js';
export { createServer, type CentralServer } from './server.js';
export { createApi } from './api.js';
export { openStore } from './store/index.js';
export type * from './store/types.js';
export type { CentralContext } from './context.js';
export type { PageView } from './view.js';
