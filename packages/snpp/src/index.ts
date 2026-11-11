/**
 * @bipeur/snpp — SNPP level 3 (RFC 1861) gateway.
 *
 * The pager protocol of 1995, as the attention layer of 2026: a plain TCP
 * client opens a two-way transaction, and Beeper pages a human.
 *
 *   import { createGateway, httpBeeperClient } from '@bipeur/snpp';
 *
 * `bin.ts` is the runnable entry point (`bipeur-snpp`).
 */
export * from './protocol.js';
export * from './parser.js';
export * from './transaction.js';
export * from './client.js';
export * from './gateway.js';
export * from './config.js';
export * from './transcript.js';

export const PACKAGE_NAME = '@bipeur/snpp';
